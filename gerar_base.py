"""Gera a base de disparo direto do banco.

Fluxo:
    1. Le as conversas do periodo (messagesdb).
    2. Descarta quem ja escolheu opcao de pagamento.
    3. Enriquece com o cadastro do cliente (b2bcustomers-db).
    4. Mantem so quem nao interagiu e esta em bucket/situacao elegivel.
    5. Soma os clientes novos do periodo.
    6. Separa por rating e grava os CSVs de duas colunas em out/.

Uso:
    python gerar_base.py
    python gerar_base.py --data-inicio 2026-08-01 --data-fim 2026-08-10
    python gerar_base.py --hora 17H --sem-relatorio
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
from datetime import timedelta as td
from pathlib import Path

import pandas as pd

import config
from banco import (
    buscar_dados_customer,
    consultar_novos,
    consultar_report,
    customers_engine,
    messages_engine,
)
from contatos import (
    TIPOS_VALIDOS,
    Registro,
    ResultadoContatos,
    aplicar_filtro,
    clear_output_folder,
    coletar_contatos,
    escrever_copy,
    escrever_grupos,
    imprimir_resumo,
    ler_telefones_filtro,
)

# Quem esta em pre-cobranca ou ja passou de 97 dias nao entra no disparo.
BUCKETS_BLOQUEADOS = {"pre-cobrança", "pre-cobranca", "acima de 97"}

# Baixa por acordo (C) ou quitacao (Q): nao pode ser cobrado.
IND_BAIXA_BLOQUEADO = {"C", "Q"}

NAO_LOCALIZADO = "NAO LOCALIZADO"

# Colunas que descem do cadastro para a base de disparo.
COLUNAS_LOOKUP = ["nome", "tipo", "telefone_2", "dias_atraso", "bucket", "valor_princ", "rating", "cpf", "ind_baixa"]
COLUNAS_DISPARO = ["telefone", "nome", "tipo", "bucket", "rating"]


def periodo_padrao(hoje: date | None = None) -> tuple[date, date]:
    """Ontem ate hoje; na segunda-feira volta ate a sexta anterior."""
    hoje = hoje or date.today()

    if hoje.weekday() == 0:
        return hoje - td(days=3), hoje

    return hoje - td(days=1), hoje


def montar_lookup(df_customer: pd.DataFrame) -> pd.DataFrame:
    """Indexa o cadastro por qualquer um dos telefones do cliente."""
    frames = []

    for origem in ("telefone", "telefone_2", "telefone_3"):
        if origem not in df_customer.columns:
            continue

        colunas = [origem] + [c for c in COLUNAS_LOOKUP if c in df_customer.columns and c != origem]
        frames.append(df_customer[colunas].rename(columns={origem: "telefone"}))

    if not frames:
        return pd.DataFrame(columns=["telefone"] + COLUNAS_LOOKUP)

    df_lookup = pd.concat(frames, ignore_index=True)
    df_lookup["telefone"] = df_lookup["telefone"].astype("string").str.strip()
    df_lookup = df_lookup[df_lookup["telefone"].notna() & df_lookup["telefone"].str.len().gt(0)]

    return df_lookup.drop_duplicates(subset=["telefone"], keep="first")


def _filtrar_telefone_preenchido(df: pd.DataFrame) -> pd.DataFrame:
    df["telefone"] = df["telefone"].astype("string").str.strip()

    return df[df["telefone"].notna() & df["telefone"].str.len().gt(0)].reset_index(drop=True)


def _remover_ind_baixa_bloqueado(df: pd.DataFrame) -> pd.DataFrame:
    if "ind_baixa" not in df.columns:
        return df

    return df[~df["ind_baixa"].isin(IND_BAIXA_BLOQUEADO)].reset_index(drop=True)


def montar_base(df_report: pd.DataFrame, df_customer: pd.DataFrame) -> pd.DataFrame:
    """Junta as conversas com o cadastro, marcando o que nao foi localizado."""
    df_final = df_report.merge(montar_lookup(df_customer), on="telefone", how="left")

    for col in COLUNAS_LOOKUP:
        if col not in df_final.columns:
            df_final[col] = pd.NA

    preencher = [col for col in ("nome", "tipo", "bucket", "telefone_2", "valor_princ", "cpf") if col in df_final.columns]
    df_final[preencher] = df_final[preencher].fillna(NAO_LOCALIZADO)
    df_final["rating"] = df_final["rating"].fillna("")

    return df_final


def filtrar_elegiveis(df_final: pd.DataFrame) -> pd.DataFrame:
    """Quem nao interagiu, esta em bucket cobravel e nao teve baixa."""
    df = df_final[df_final["houve_interacao"] == "NAO"].copy()

    bucket = df["bucket"].astype("string").str.lower().str.strip()
    df = df[~bucket.isin(BUCKETS_BLOQUEADOS)].reset_index(drop=True)

    return _remover_ind_baixa_bloqueado(df)


def preparar_novos(df_novos: pd.DataFrame, telefones_em_uso: pd.Series) -> pd.DataFrame:
    if df_novos.empty:
        return df_novos

    df_novos = _remover_ind_baixa_bloqueado(df_novos)
    df_novos = _filtrar_telefone_preenchido(df_novos)

    return df_novos[~df_novos["telefone"].isin(telefones_em_uso)].reset_index(drop=True)


def montar_disparo(df_elegiveis: pd.DataFrame, df_novos: pd.DataFrame) -> pd.DataFrame:
    """Une base e novos, mantendo so quem tem tipo conhecido."""
    partes = []

    for df in (df_elegiveis, df_novos):
        if df.empty:
            continue

        faltando = [col for col in COLUNAS_DISPARO if col not in df.columns]
        if faltando:
            raise KeyError(f"Colunas ausentes para o disparo: {', '.join(faltando)}.")

        partes.append(df[COLUNAS_DISPARO])

    if not partes:
        return pd.DataFrame(columns=COLUNAS_DISPARO)

    df_disparo = pd.concat(partes, ignore_index=True)
    tipo = df_disparo["tipo"].astype("string").str.strip().str.lower()

    # "NAO LOCALIZADO" nao tem cadastro, entao nao ha o que cobrar.
    return df_disparo[tipo.isin(TIPOS_VALIDOS)].reset_index(drop=True)


def gravar_relatorio(
    report_dir: Path,
    data_referencia: date,
    df_final: pd.DataFrame,
    df_novos: pd.DataFrame,
    df_disparo: pd.DataFrame,
) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)

    nome = f"Base_interacoes_porto_{data_referencia.strftime('%Y%m%d')}"
    arquivo = report_dir / f"{nome}.xlsx"

    contador = 1
    while arquivo.exists():
        contador += 1
        arquivo = report_dir / f"{nome}_{contador}.xlsx"

    df_interagiram = df_final[df_final["houve_interacao"] == "SIM"].reset_index(drop=True)

    with pd.ExcelWriter(arquivo, engine="openpyxl") as writer:
        df_final.to_excel(writer, sheet_name="Base", index=False)
        df_interagiram.to_excel(writer, sheet_name="Interagiram", index=False)
        df_novos.to_excel(writer, sheet_name="Novos", index=False)
        df_disparo.to_excel(writer, sheet_name="Disparo", index=False)

    return arquivo


def gerar(
    data_inicio: date,
    data_fim: date,
    hora: str,
    com_relatorio: bool,
    com_copy: bool,
) -> ResultadoContatos:
    engine_mensagens = messages_engine()
    engine_clientes = customers_engine()

    try:
        print(f"Periodo: {data_inicio:%d/%m/%Y} a {data_fim:%d/%m/%Y}.")

        df_report = consultar_report(engine_mensagens, data_inicio, data_fim, config.owner_id())
        print(f"Conversas no periodo: {len(df_report)}.")

        if "telefone" not in df_report.columns:
            raise KeyError("A coluna 'telefone' nao foi retornada por consulta_report.sql.")

        # Quem ja escolheu uma opcao de pagamento nao deve ser cobrado de novo.
        if "tag_opcao_pagamento" in df_report.columns:
            sem_opcao = df_report["tag_opcao_pagamento"]
            df_report = df_report[sem_opcao.isna() | sem_opcao.str.strip().eq("")].reset_index(drop=True)

        df_report = _filtrar_telefone_preenchido(df_report)

        telefones = df_report["telefone"].dropna().unique().tolist()
        df_customer = buscar_dados_customer(engine_clientes, telefones)
        print(f"Cadastros localizados: {len(df_customer)}.")

        df_final = montar_base(df_report, df_customer)
        df_elegiveis = filtrar_elegiveis(df_final)
        print(f"Elegiveis apos filtros: {len(df_elegiveis)}.")

        df_novos = consultar_novos(engine_clientes, data_inicio, data_fim)
        df_novos = preparar_novos(df_novos, df_elegiveis["telefone"])
        print(f"Clientes novos no periodo: {len(df_novos)}.")

        df_disparo = montar_disparo(df_elegiveis, df_novos)
    finally:
        engine_mensagens.dispose()
        engine_clientes.dispose()

    registros = (
        Registro(
            telefone=linha.telefone,
            nome=linha.nome,
            tipo=linha.tipo,
            rating=linha.rating,
        )
        for linha in df_disparo.itertuples(index=False)
    )
    resultado = coletar_contatos(registros)

    telefones_filtro = ler_telefones_filtro(config.FILTER_DIR)
    if telefones_filtro:
        resultado.grupos, removidos = aplicar_filtro(resultado.grupos, telefones_filtro)
        print(f"Filtro: {removidos} contato(s) removido(s) ({len(telefones_filtro)} numero(s) na planilha de filtro).")

    clear_output_folder(config.OUTPUT_DIR)
    escrever_grupos(config.OUTPUT_DIR, resultado.grupos)

    print("Base gerada com sucesso.")
    imprimir_resumo(resultado)

    if com_copy:
        escrever_copy(config.COPY_FILE, resultado.grupos, data_fim, hora)
        print(f"Copy das campanhas em {config.COPY_FILE.name}.")

    if com_relatorio:
        arquivo = gravar_relatorio(config.REPORT_DIR, data_fim, df_final, df_novos, df_disparo)
        print(f"Relatorio salvo em {arquivo}.")

    return resultado


def parse_data(valor: str) -> date:
    try:
        return datetime.strptime(valor, "%Y-%m-%d").date()
    except ValueError as erro:
        raise argparse.ArgumentTypeError(f"Data invalida: '{valor}'. Use o formato AAAA-MM-DD.") from erro


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gera os CSVs de disparo a partir do banco.")
    parser.add_argument("--data-inicio", type=parse_data, help="Inicio do periodo (AAAA-MM-DD).")
    parser.add_argument("--data-fim", type=parse_data, help="Fim do periodo (AAAA-MM-DD).")
    parser.add_argument("--hora", help="Hora do disparo usada no copy.md (padrao: hora atual, ex.: 17H).")
    parser.add_argument("--sem-relatorio", action="store_true", help="Nao gera o Excel de conferencia.")
    parser.add_argument("--sem-copy", action="store_true", help="Nao reescreve o copy.md.")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config.load_env()

    inicio_padrao, fim_padrao = periodo_padrao()
    data_inicio = args.data_inicio or inicio_padrao
    data_fim = args.data_fim or fim_padrao

    if data_inicio > data_fim:
        print("Data de inicio maior que a data de fim.")
        return 1

    hora = args.hora or f"{datetime.now():%H}H"

    resultado = gerar(
        data_inicio=data_inicio,
        data_fim=data_fim,
        hora=hora,
        com_relatorio=not args.sem_relatorio,
        com_copy=not args.sem_copy,
    )

    return 0 if resultado.total_contatos else 1


if __name__ == "__main__":
    raise SystemExit(main())
