"""Gera a base de disparo da Operacao B direto do banco de clientes.

Fluxo (mais curto que o da Operacao A, que cruza mensagens com cadastro):
    1. Le a base da operacao B (b2bcustomers-db), um registro por telefone.
    2. Aplica o filtro manual da pasta filtros/.
    3. Separa por rating nas cinco planilhas e grava os CSVs em out_b/.

Uso:
    python gerar_base_b.py
    python gerar_base_b.py --sem-filtro-removidos
"""

from __future__ import annotations

import argparse
import json
from datetime import date
from typing import Callable

import config
from banco import consultar_operacao_b, customers_engine
from contatos import aplicar_filtro, clear_output_folder, escrever_filtro_removidos, ler_telefones_filtro
from contatos_b import (
    RegistroB,
    ResultadoContatosB,
    coletar_contatos_b,
    escrever_grupos_b,
    imprimir_resumo_b,
)

# Mesmo protocolo do gerar_base.py: uma linha extra no stdout que a tela le como
# evento estruturado, sem tirar a legibilidade de quem roda no terminal.
MARCA_METRICA = "[METRICA] "


def _metrica(chave: str, valor: object, rotulo: str, **extra: object) -> None:
    print(f"{MARCA_METRICA}{json.dumps({'chave': chave, 'valor': valor, 'rotulo': rotulo, **extra}, ensure_ascii=False)}")


class OperacaoCancelada(Exception):
    """Levantada quando a tela pede cancelamento no meio da geracao."""


def _checar_cancelamento(deve_cancelar: Callable[[], bool]) -> None:
    if deve_cancelar():
        raise OperacaoCancelada("Geracao cancelada pela tela.")


def gerar(
    dry_run: bool = False,
    deve_cancelar: Callable[[], bool] = lambda: False,
) -> ResultadoContatosB:
    engine_clientes = customers_engine()

    try:
        print("Operacao B: lendo a base de clientes.")

        df = consultar_operacao_b(engine_clientes)
        print(f"Registros da operacao B: {len(df)}.")
        _metrica("registros_operacao_b", len(df), "Registros da operacao B")
        _checar_cancelamento(deve_cancelar)

        for coluna in ("telefone", "nome", "rating", "cpf"):
            if coluna not in df.columns:
                raise KeyError(f"A coluna '{coluna}' nao foi retornada por consulta_operacao_b.sql.")
    finally:
        engine_clientes.dispose()

    registros = (
        RegistroB(telefone=linha.telefone, nome=linha.nome, rating=linha.rating, cpf=linha.cpf)
        for linha in df.itertuples(index=False)
    )
    resultado = coletar_contatos_b(registros)

    _metrica("contatos_validos", resultado.total_contatos, "Contatos validos")
    _metrica("duplicados_telefone", resultado.duplicados_telefone, "Telefone repetido")
    _metrica("duplicados_cpf", resultado.duplicados_cpf, "CPF repetido (mesma pessoa)")
    _metrica("sem_nome", resultado.sem_nome, "Sem nome (tratados como Cliente)")
    print(
        f"Deduplicacao: {resultado.duplicados_telefone} por telefone repetido, "
        f"{resultado.duplicados_cpf} por CPF repetido."
    )
    _checar_cancelamento(deve_cancelar)

    telefones_filtro = ler_telefones_filtro(config.FILTER_DIR)
    if telefones_filtro:
        resultado.grupos, removidos_por_grupo = aplicar_filtro(resultado.grupos, telefones_filtro)
        total_removidos = sum(len(linhas) for linhas in removidos_por_grupo.values())
        print(f"Filtro: {total_removidos} contato(s) removido(s) ({len(telefones_filtro)} numero(s) na planilha de filtro).")
        _metrica(
            "filtro", total_removidos, "Filtro: removidos",
            telefones_filtro=len(telefones_filtro),
            por_grupo={grupo: len(linhas) for grupo, linhas in removidos_por_grupo.items()},
        )

        if not dry_run and removidos_por_grupo:
            arquivo_removidos = escrever_filtro_removidos(config.REPORT_DIR, date.today(), removidos_por_grupo)
            print(f"Removidos do filtro salvos em {arquivo_removidos}.")

    _checar_cancelamento(deve_cancelar)

    if not dry_run:
        clear_output_folder(config.OUTPUT_DIR_B)
        escrever_grupos_b(config.OUTPUT_DIR_B, resultado.grupos)
        print("Base da operacao B gerada com sucesso.")
    else:
        print("Pre-visualizacao: nenhum CSV foi gravado.")

    imprimir_resumo_b(resultado)

    return resultado


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Gera os CSVs de disparo da Operacao B a partir do banco.")
    parser.add_argument("--previa", action="store_true", help="So mostra as contagens, sem gravar CSV.")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config.load_env()

    resultado = gerar(dry_run=args.previa)

    return 0 if resultado.total_contatos else 1


if __name__ == "__main__":
    raise SystemExit(main())
