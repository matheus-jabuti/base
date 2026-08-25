"""Testes das regras de contato: normalizacao, agrupamento por rating e dedup."""

from __future__ import annotations

import csv
from datetime import date

from openpyxl import Workbook

from contatos import (
    CSV_PARA_GRUPO,
    GROUP_ABW,
    GROUP_C,
    GROUP_CONTENCIOSO,
    GROUP_DEZ,
    GROUP_NA_RATING,
    OUTPUT_FILES,
    Registro,
    aplicar_filtro,
    coletar_contatos,
    escrever_filtro_removidos,
    ler_telefones_filtro,
    normalize_name,
    normalize_phone,
    rating_desconhecido,
    resolve_group,
)


def test_normalize_phone_mantem_so_digitos():
    assert normalize_phone("(11) 91234-5678") == "11912345678"


def test_normalize_phone_descarta_curto_demais():
    assert normalize_phone("123456789") is None  # 9 digitos


def test_normalize_phone_aceita_minimo_de_10_digitos():
    assert normalize_phone("1123456789") == "1123456789"


def test_normalize_phone_none_e_vazio():
    assert normalize_phone(None) is None
    assert normalize_phone("") is None


def test_normalize_phone_float_sem_casas_decimais():
    assert normalize_phone(11912345678.0) == "11912345678"


def test_normalize_name_colapsa_espacos_e_titula():
    assert normalize_name("  joao   da  silva ") == "Joao Da Silva"


def test_normalize_name_vazio_vira_none():
    assert normalize_name("   ") is None
    assert normalize_name(None) is None


def test_resolve_group_contencioso_ignora_rating():
    assert resolve_group("contencioso", "A") == GROUP_CONTENCIOSO
    assert resolve_group("Contencioso", None) == GROUP_CONTENCIOSO


def test_resolve_group_amigavel_por_primeira_letra():
    assert resolve_group("amigavel", "A") == GROUP_ABW
    assert resolve_group("amigavel", "B") == GROUP_ABW
    assert resolve_group("amigavel", "W") == GROUP_ABW
    assert resolve_group("amigavel", "C") == GROUP_C
    assert resolve_group("amigavel", "D") == GROUP_DEZ
    assert resolve_group("amigavel", "E") == GROUP_DEZ
    assert resolve_group("amigavel", "Z") == GROUP_DEZ


def test_resolve_group_rating_prefixado_usa_primeira_letra():
    assert resolve_group("amigavel", "Z_REDUCAO") == GROUP_DEZ
    assert resolve_group("amigavel", "W_FPD_COM_PL") == GROUP_ABW


def test_resolve_group_sem_rating_ou_desconhecido():
    assert resolve_group("amigavel", None) == GROUP_NA_RATING
    assert resolve_group("amigavel", "") == GROUP_NA_RATING
    assert resolve_group("amigavel", "X") == GROUP_NA_RATING


def test_rating_desconhecido():
    assert rating_desconhecido("X") is True
    assert rating_desconhecido("A") is False
    assert rating_desconhecido(None) is False
    assert rating_desconhecido("") is False


def test_coletar_contatos_dedup_global_entre_grupos():
    registros = [
        Registro(telefone="11912345678", nome="Joao", tipo="amigavel", rating="A"),
        # mesmo telefone, outro grupo (contencioso) -- nao pode duplicar disparo
        Registro(telefone="11912345678", nome="Joao", tipo="contencioso", rating=None),
    ]

    resultado = coletar_contatos(registros)

    assert resultado.total_contatos == 1
    assert resultado.duplicados == 1
    assert resultado.grupos[GROUP_ABW] == [("11912345678", "Joao")]
    assert resultado.grupos[GROUP_CONTENCIOSO] == []


def test_coletar_contatos_descarta_telefone_invalido_e_sem_nome():
    registros = [
        Registro(telefone="123", nome="Joao", tipo="amigavel", rating="A"),
        Registro(telefone="11912345678", nome="   ", tipo="amigavel", rating="A"),
    ]

    resultado = coletar_contatos(registros)

    assert resultado.total_contatos == 0
    assert resultado.telefone_invalido == 1
    assert resultado.sem_nome == 1


def test_coletar_contatos_conta_rating_desconhecido_so_para_amigavel():
    registros = [
        Registro(telefone="11912345678", nome="Joao", tipo="amigavel", rating="X"),
        Registro(telefone="11987654321", nome="Maria", tipo="contencioso", rating="X"),
    ]

    resultado = coletar_contatos(registros)

    assert resultado.ratings_desconhecidos["X"] == 1
    assert resultado.grupos[GROUP_NA_RATING] == [("11912345678", "Joao")]
    assert resultado.grupos[GROUP_CONTENCIOSO] == [("11987654321", "Maria")]


def test_aplicar_filtro_remove_por_telefone_em_qualquer_grupo():
    grupos = {
        GROUP_ABW: [("11912345678", "Joao"), ("11900000000", "Ana")],
        GROUP_C: [("11987654321", "Maria")],
    }

    filtrados, removidos_por_grupo = aplicar_filtro(grupos, {"11912345678", "11987654321"})

    assert filtrados[GROUP_ABW] == [("11900000000", "Ana")]
    assert filtrados[GROUP_C] == []
    assert removidos_por_grupo[GROUP_ABW] == [("11912345678", "Joao")]
    assert removidos_por_grupo[GROUP_C] == [("11987654321", "Maria")]
    assert sum(len(linhas) for linhas in removidos_por_grupo.values()) == 2


def test_aplicar_filtro_sem_telefones_nao_mexe_nos_grupos():
    grupos = {GROUP_ABW: [("11912345678", "Joao")]}

    filtrados, removidos_por_grupo = aplicar_filtro(grupos, set())

    assert removidos_por_grupo == {}
    assert filtrados is grupos


def test_escrever_filtro_removidos_grava_csv_com_grupo(tmp_path):
    removidos_por_grupo = {
        GROUP_ABW: [("11912345678", "Joao")],
        GROUP_C: [("11987654321", "Maria")],
    }

    arquivo = escrever_filtro_removidos(tmp_path, date(2026, 8, 25), removidos_por_grupo)
    linhas = list(csv.reader(arquivo.open(encoding="utf-8")))

    assert arquivo.name == "filtro_removidos_20260825.csv"
    assert linhas[0] == ["telefone", "nome", "grupo"]
    assert ["11912345678", "Joao", GROUP_ABW] in linhas
    assert ["11987654321", "Maria", GROUP_C] in linhas


def test_escrever_filtro_removidos_nao_sobrescreve_mesmo_dia(tmp_path):
    removidos_por_grupo = {GROUP_ABW: [("11912345678", "Joao")]}

    primeiro = escrever_filtro_removidos(tmp_path, date(2026, 8, 25), removidos_por_grupo)
    segundo = escrever_filtro_removidos(tmp_path, date(2026, 8, 25), removidos_por_grupo)

    assert primeiro != segundo
    assert primeiro.exists() and segundo.exists()


def test_csv_para_grupo_cobre_todos_os_grupos():
    assert set(CSV_PARA_GRUPO.values()) == set(OUTPUT_FILES.keys())
    assert set(CSV_PARA_GRUPO.keys()) == set(OUTPUT_FILES.values())


def test_ler_telefones_filtro_le_xlsx_sem_cabecalho_fixo(tmp_path):
    planilha = tmp_path / "filtro.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Telefones para remover"])
    sheet.append(["(11) 91234-5678"])
    sheet.append(["11 90000-0000"])
    sheet.append(["numero curto: 123"])
    workbook.save(planilha)

    telefones = ler_telefones_filtro(tmp_path)

    assert telefones == {"11912345678", "11900000000"}


def test_ler_telefones_filtro_le_csv(tmp_path):
    arquivo = tmp_path / "filtro.csv"
    with arquivo.open("w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["telefone"])
        writer.writerow(["11912345678"])

    assert ler_telefones_filtro(tmp_path) == {"11912345678"}


def test_ler_telefones_filtro_pasta_vazia_ou_ausente(tmp_path):
    assert ler_telefones_filtro(tmp_path) == set()
    assert ler_telefones_filtro(tmp_path / "nao-existe") == set()
