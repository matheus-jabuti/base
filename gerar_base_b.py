"""Gera a base de disparo da Operacao B a partir da planilha em in_b/.

Fluxo (mais curto que o da Operacao A, que cruza mensagens com cadastro):
    1. Le a(s) planilha(s) xlsx de in_b/ (colunas phone_number, nome, prioridade;
       nome do arquivo pode variar).
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
from pathlib import Path
from typing import Callable

from openpyxl import load_workbook

import config
from contatos import aplicar_filtro, clear_output_folder, escrever_filtro_removidos, ler_telefones_filtro, normalize_header
from contatos_b import (
    RegistroB,
    ResultadoContatosB,
    coletar_contatos_b,
    escrever_grupos_b,
    imprimir_resumo_b,
)

# Colunas esperadas na planilha de in_b/, comparadas ja normalizadas (minusculo).
COLUNAS_PLANILHA_B = ("phone_number", "nome", "prioridade")


def find_input_excels_b(input_dir: Path) -> list[Path]:
    return sorted(input_dir.glob("*.xlsx"))


def ler_planilha_b(excel_path: Path) -> list[RegistroB]:
    """Le uma planilha da Operacao B (aba unica, cabecalho na linha 1)."""
    workbook = load_workbook(excel_path, read_only=True, data_only=True)

    try:
        sheet = workbook[workbook.sheetnames[0]]
        header_row = next(sheet.iter_rows(min_row=1, max_row=1, values_only=True), ())
        normalized = [normalize_header(cell) for cell in header_row]

        indices: dict[str, int] = {}
        for coluna in COLUNAS_PLANILHA_B:
            if coluna in normalized:
                indices[coluna] = normalized.index(coluna)

        faltando = [coluna for coluna in COLUNAS_PLANILHA_B if coluna not in indices]
        if faltando:
            encontrado = ", ".join(str(cell) for cell in header_row)
            raise ValueError(
                f"Planilha {excel_path.name} sem as colunas: {', '.join(faltando)}. "
                f"Cabecalho encontrado: {encontrado}."
            )

        registros: list[RegistroB] = []
        for row in sheet.iter_rows(min_row=2, values_only=True):
            def valor(coluna: str, row=row) -> object:
                idx = indices[coluna]
                return row[idx] if idx < len(row) else None

            telefone = valor("phone_number")
            nome = valor("nome")
            if telefone is None and nome is None:
                continue

            registros.append(RegistroB(telefone=telefone, nome=nome, rating=valor("prioridade"), cpf=None))

        return registros
    finally:
        workbook.close()

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
    print("Operacao B: lendo a planilha de clientes.")

    excel_files = find_input_excels_b(config.INPUT_DIR_B)
    if not excel_files:
        raise FileNotFoundError(f"Nenhum Excel encontrado em {config.INPUT_DIR_B}.")

    registros: list[RegistroB] = []
    for excel_file in excel_files:
        registros.extend(ler_planilha_b(excel_file))

    print(f"Registros da operacao B: {len(registros)}.")
    _metrica("registros_operacao_b", len(registros), "Registros da operacao B")
    _checar_cancelamento(deve_cancelar)

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
    parser = argparse.ArgumentParser(description="Gera os CSVs de disparo da Operacao B a partir da planilha em in_b/.")
    parser.add_argument("--previa", action="store_true", help="So mostra as contagens, sem gravar CSV.")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    config.load_env()

    resultado = gerar(dry_run=args.previa)

    return 0 if resultado.total_contatos else 1


if __name__ == "__main__":
    raise SystemExit(main())
