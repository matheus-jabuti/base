"""Testes das regras de contato: normalizacao, agrupamento por rating e dedup."""

from __future__ import annotations

from contatos import (
    GROUP_ABW,
    GROUP_C,
    GROUP_CONTENCIOSO,
    GROUP_DEZ,
    GROUP_NA_RATING,
    Registro,
    coletar_contatos,
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
