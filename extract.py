"""Gera os CSVs de disparo a partir de um Excel ja montado.

Caminho manual: quando a planilha TempA/TempB chega pronta, coloque o
arquivo em in/ e rode este script. Para gerar tudo direto do banco, use
gerar_base.py.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime
from pathlib import Path

from openpyxl import load_workbook

import config
from contatos import (
    Registro,
    ResultadoContatos,
    clear_output_folder,
    coletar_contatos,
    escrever_copy,
    escrever_grupos,
    imprimir_resumo,
    normalize_header,
    normalize_sheet_name,
)

INPUT_DIR = config.INPUT_DIR
OUTPUT_DIR = config.OUTPUT_DIR

# Abas da planilha de entrada que contem os contatos a disparar.
SOURCE_SHEETS = ("tempa", "tempb")

BLOCK_COLUMNS = ("nome", "tipo", "rating")


def find_blocks(header: tuple[object, ...]) -> list[dict[str, int]]:
    """Localiza os blocos de contatos do cabecalho.

    Cada bloco comeca em uma coluna "telefone" e usa as colunas "nome",
    "tipo" e "rating" seguintes, antes do proximo "telefone".
    """
    normalized = [normalize_header(cell) for cell in header]
    phone_cols = [idx for idx, name in enumerate(normalized) if name == "telefone"]

    if not phone_cols:
        found = ", ".join(str(cell) for cell in header)
        raise ValueError(f"Cabecalho invalido: nenhuma coluna 'telefone'. Cabecalho encontrado: {found}")

    blocks: list[dict[str, int]] = []

    for position, phone_col in enumerate(phone_cols):
        end = phone_cols[position + 1] if position + 1 < len(phone_cols) else len(normalized)
        block = {"telefone": phone_col}

        for column in BLOCK_COLUMNS:
            for idx in range(phone_col + 1, end):
                if normalized[idx] == column:
                    block[column] = idx
                    break

        missing = [column for column in BLOCK_COLUMNS if column not in block]
        if missing:
            raise ValueError(
                f"Bloco iniciado na coluna {phone_col + 1} sem as colunas: {', '.join(missing)}."
            )

        blocks.append(block)

    return blocks


def collect_rows(sheet) -> list[Registro]:
    """Le a aba e devolve os registros brutos de todos os blocos."""
    header_row = next(sheet.iter_rows(min_row=2, max_row=2, values_only=True), ())
    blocks = find_blocks(header_row)

    collected: list[Registro] = []

    for row in sheet.iter_rows(min_row=3, values_only=True):
        for block in blocks:
            valores = {
                nome: row[indice] if indice < len(row) else None
                for nome, indice in block.items()
            }

            if valores["telefone"] is None and valores["nome"] is None:
                continue

            collected.append(
                Registro(
                    telefone=valores["telefone"],
                    nome=valores["nome"],
                    tipo=valores["tipo"],
                    rating=valores["rating"],
                )
            )

    return collected


def ler_excel(excel_path: Path) -> list[Registro]:
    workbook = load_workbook(excel_path, read_only=True, data_only=True)

    try:
        sheet_lookup = {normalize_sheet_name(name): name for name in workbook.sheetnames}
        registros: list[Registro] = []

        for sheet_name in SOURCE_SHEETS:
            actual_sheet_name = sheet_lookup.get(normalize_sheet_name(sheet_name))
            if actual_sheet_name is None:
                available = ", ".join(workbook.sheetnames)
                raise ValueError(
                    f"A planilha '{sheet_name}' nao existe em {excel_path.name}. "
                    f"Planilhas disponiveis: {available}."
                )

            registros.extend(collect_rows(workbook[actual_sheet_name]))

        return registros
    finally:
        workbook.close()


def find_input_excels(input_dir: Path) -> list[Path]:
    patterns = ("*.xlsx", "*.xlsm", "*.xltx", "*.xltm")
    files: list[Path] = []

    for pattern in patterns:
        files.extend(input_dir.glob(pattern))

    return sorted(files)


def extrair(excel_files: list[Path], hora: str, com_copy: bool, data_disparo: date) -> ResultadoContatos:
    registros: list[Registro] = []
    for excel_file in excel_files:
        registros.extend(ler_excel(excel_file))

    # TempA e TempB sao unificadas e deduplicadas: o mesmo telefone nao pode
    # receber dois disparos.
    resultado = coletar_contatos(registros)

    clear_output_folder(OUTPUT_DIR)
    escrever_grupos(OUTPUT_DIR, resultado.grupos)

    print("Extracao concluida com sucesso.")
    imprimir_resumo(resultado)

    if com_copy:
        escrever_copy(config.COPY_FILE, resultado.grupos, data_disparo, hora)
        print(f"Copy das campanhas em {config.COPY_FILE.name}.")

    return resultado


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Converte os Excels de in/ nos CSVs de disparo.")
    parser.add_argument("--hora", help="Hora do disparo usada no copy.md (padrao: hora atual, ex.: 17H).")
    parser.add_argument("--sem-copy", action="store_true", help="Nao reescreve o copy.md.")
    parser.add_argument("--manter-excel", action="store_true", help="Nao apaga os Excels de in/ ao final.")

    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    excel_files = find_input_excels(INPUT_DIR)
    if not excel_files:
        print("Nenhum Excel encontrado em in/.")
        return 1

    hora = args.hora or f"{datetime.now():%H}H"
    extrair(excel_files, hora=hora, com_copy=not args.sem_copy, data_disparo=date.today())

    if not args.manter_excel:
        for excel_file in excel_files:
            excel_file.unlink(missing_ok=True)

        print("Excels removidos de in/.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
