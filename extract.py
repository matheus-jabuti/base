from __future__ import annotations

import csv
import shutil
from pathlib import Path
from typing import Iterable

from openpyxl import load_workbook

INPUT_DIR = Path(__file__).resolve().parent / "in"
OUTPUT_DIR = Path(__file__).resolve().parent / "out"

# Abas da planilha de entrada que contem os contatos a disparar.
SOURCE_SHEETS = ("tempa", "tempb")

# Cada grupo vira um CSV de saida. O contencioso nao e separado por rating.
GROUP_ABW = "abw"
GROUP_C = "c"
GROUP_DEZ = "dez"
GROUP_SEM_RATING = "sem_rating"
GROUP_CONTENCIOSO = "contencioso"

OUTPUT_FILES = {
    GROUP_ABW: "amigavel_ABW.csv",
    GROUP_C: "amigavel_C.csv",
    GROUP_DEZ: "amigavel_DEZ.csv",
    GROUP_SEM_RATING: "amigavel_sem_rating.csv",
    GROUP_CONTENCIOSO: "contencioso.csv",
}

# O rating vem como "A", "B", "C", "D", "E" ou prefixado ("Z_REDUCAO",
# "W_FPD_COM_PL", ...). A primeira letra define o grupo.
RATING_GROUPS = {
    "A": GROUP_ABW,
    "B": GROUP_ABW,
    "W": GROUP_ABW,
    "C": GROUP_C,
    "D": GROUP_DEZ,
    "E": GROUP_DEZ,
    "Z": GROUP_DEZ,
}


def normalize_sheet_name(name: object) -> str:
    return str(name).strip().lower()


def clear_output_folder(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)

    for item in output_dir.iterdir():
        if item.name == ".gitkeep" and item.is_file():
            continue

        if item.is_dir():
            shutil.rmtree(item)
        else:
            item.unlink()


def normalize_phone(value: object) -> str | None:
    if value is None:
        return None

    if isinstance(value, int):
        return str(value)

    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else "".join(ch for ch in str(value) if ch.isdigit())

    digits = "".join(ch for ch in str(value).strip() if ch.isdigit())
    return digits or None


def normalize_name(value: object) -> str | None:
    if value is None:
        return None

    name = " ".join(str(value).split())
    if not name:
        return None

    return name.lower().title()


def normalize_header(value: object) -> str:
    return str(value).strip().lower()


def resolve_group(tipo: object, rating: object) -> str:
    """Define em qual CSV a linha entra.

    Contencioso ignora o rating. Amigavel usa a primeira letra do rating;
    sem rating vai para o CSV proprio.
    """
    if tipo is not None and "contencioso" in str(tipo).strip().lower():
        return GROUP_CONTENCIOSO

    if rating is None:
        return GROUP_SEM_RATING

    rating_text = str(rating).strip().upper()
    if not rating_text:
        return GROUP_SEM_RATING

    group = RATING_GROUPS.get(rating_text[0])
    if group is None:
        raise ValueError(f"Rating desconhecido: '{rating}'.")

    return group


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

        for column in ("nome", "tipo", "rating"):
            for idx in range(phone_col + 1, end):
                if normalized[idx] == column:
                    block[column] = idx
                    break

        missing = [column for column in ("nome", "tipo", "rating") if column not in block]
        if missing:
            raise ValueError(
                f"Bloco iniciado na coluna {phone_col + 1} sem as colunas: {', '.join(missing)}."
            )

        blocks.append(block)

    return blocks


def collect_rows(sheet) -> list[tuple[str, str, str]]:
    """Le a aba e devolve (grupo, telefone, nome) de todos os blocos."""
    header_row = next(sheet.iter_rows(min_row=2, max_row=2, values_only=True), ())
    blocks = find_blocks(header_row)

    collected: list[tuple[str, str, str]] = []

    for row in sheet.iter_rows(min_row=3, values_only=True):
        for block in blocks:
            phone = normalize_phone(row[block["telefone"]] if block["telefone"] < len(row) else None)
            name = normalize_name(row[block["nome"]] if block["nome"] < len(row) else None)

            if not phone or not name:
                continue

            tipo = row[block["tipo"]] if block["tipo"] < len(row) else None
            rating = row[block["rating"]] if block["rating"] < len(row) else None

            collected.append((resolve_group(tipo, rating), phone, name))

    return collected


def write_csv(file_path: Path, data: Iterable[tuple[str, str]]) -> None:
    with file_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["phonenumber", "name"])
        writer.writerows(data)


def process_excel(excel_path: Path, output_dir: Path) -> dict[str, int]:
    workbook = load_workbook(excel_path, read_only=True, data_only=True)

    try:
        sheet_lookup = {normalize_sheet_name(name): name for name in workbook.sheetnames}

        groups: dict[str, list[tuple[str, str]]] = {group: [] for group in OUTPUT_FILES}
        seen_phones: set[str] = set()

        for sheet_name in SOURCE_SHEETS:
            actual_sheet_name = sheet_lookup.get(normalize_sheet_name(sheet_name))
            if actual_sheet_name is None:
                available = ", ".join(workbook.sheetnames)
                raise ValueError(
                    f"A planilha '{sheet_name}' nao existe em {excel_path.name}. "
                    f"Planilhas disponiveis: {available}."
                )

            for group, phone, name in collect_rows(workbook[actual_sheet_name]):
                # TempA e TempB sao unificadas: o mesmo telefone nao pode
                # receber dois disparos.
                if phone in seen_phones:
                    continue

                seen_phones.add(phone)
                groups[group].append((phone, name))

        for group, rows in groups.items():
            write_csv(output_dir / OUTPUT_FILES[group], rows)

        return {group: len(rows) for group, rows in groups.items()}
    finally:
        workbook.close()


def find_input_excels(input_dir: Path) -> list[Path]:
    patterns = ("*.xlsx", "*.xlsm", "*.xltx", "*.xltm")
    files: list[Path] = []

    for pattern in patterns:
        files.extend(input_dir.glob(pattern))

    return sorted(files)


def main() -> int:
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    excel_files = find_input_excels(INPUT_DIR)
    if not excel_files:
        print("Nenhum Excel encontrado em base/in.")
        return 1

    clear_output_folder(OUTPUT_DIR)

    totals: dict[str, int] = {group: 0 for group in OUTPUT_FILES}

    for excel_file in excel_files:
        counts = process_excel(excel_file, OUTPUT_DIR)
        for group, count in counts.items():
            totals[group] += count

    for excel_file in excel_files:
        excel_file.unlink(missing_ok=True)

    print("Extracao concluida com sucesso.")
    print("Arquivos gerados:")
    for group, file_name in OUTPUT_FILES.items():
        print(f"- {file_name} ({totals[group]} contatos)")

    print("Excels removidos de base/in.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
