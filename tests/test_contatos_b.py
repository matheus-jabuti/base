import csv

import pytest

from contatos_b import (
    GROUP_AMIGAVEL_A,
    GROUP_AMIGAVEL_D,
    GROUP_CONTENCIOSO_MAIOR_500,
    GROUP_CONTENCIOSO_MENOR_500,
    GROUP_OUTROS,
    NOME_PADRAO,
    OUTPUT_FILES_B,
    RegistroB,
    coletar_contatos_b,
    escrever_grupos_b,
    normalize_name_b,
    resolve_group_b,
)


@pytest.mark.parametrize(
    "rating,esperado",
    [
        ("A", GROUP_AMIGAVEL_A),
        ("a", GROUP_AMIGAVEL_A),
        ("D", GROUP_AMIGAVEL_D),
        ("MENOR_500", GROUP_CONTENCIOSO_MENOR_500),
        ("menor_500", GROUP_CONTENCIOSO_MENOR_500),
        ("MAIOR_500", GROUP_CONTENCIOSO_MAIOR_500),
        ("Outros", GROUP_OUTROS),
    ],
)
def test_rating_conhecido_vai_para_a_propria_planilha(rating, esperado):
    assert resolve_group_b(rating) == esperado


@pytest.mark.parametrize("rating", [None, "", "   ", "B", "MENOR", "Z_REDUCAO"])
def test_rating_ausente_ou_fora_da_lista_cai_em_outros(rating):
    assert resolve_group_b(rating) == GROUP_OUTROS


# Os dois contenciosos comecam com a mesma letra: agrupar pelo prefixo (como a
# Operacao A faz) juntaria os dois na mesma planilha.
def test_contencioso_menor_e_maior_nao_se_misturam():
    assert resolve_group_b("MENOR_500") != resolve_group_b("MAIOR_500")


@pytest.mark.parametrize(
    "bruto,esperado",
    [
        ("MARIA DAS DORES", "Maria Das Dores"),
        ("joão da silva", "João Da Silva"),
        ("  ana   paula  ", "Ana Paula"),
    ],
)
def test_nome_sai_capitalizado(bruto, esperado):
    assert normalize_name_b(bruto) == esperado


@pytest.mark.parametrize("bruto", [None, "", "   "])
def test_nome_ausente_vira_cliente(bruto):
    assert normalize_name_b(bruto) == NOME_PADRAO


def test_registro_sem_nome_entra_no_disparo_como_cliente():
    resultado = coletar_contatos_b([RegistroB(telefone="47999998888", nome=None, rating="A")])

    assert resultado.grupos[GROUP_AMIGAVEL_A] == [("47999998888", NOME_PADRAO)]
    assert resultado.sem_nome == 1


def test_telefone_curto_e_descartado():
    resultado = coletar_contatos_b([RegistroB(telefone="123", nome="Ana", rating="A")])

    assert resultado.total_contatos == 0
    assert resultado.telefone_invalido == 1


def test_dedup_telefone_e_global_entre_planilhas():
    resultado = coletar_contatos_b([
        RegistroB(telefone="47999998888", nome="Ana", rating="A"),
        RegistroB(telefone="47999998888", nome="Ana", rating="MAIOR_500"),
    ])

    assert resultado.total_contatos == 1
    assert resultado.duplicados_telefone == 1
    assert resultado.duplicados_cpf == 0
    assert resultado.grupos[GROUP_CONTENCIOSO_MAIOR_500] == []


def test_dedup_cpf_mesma_pessoa_outro_numero():
    # Mesma pessoa, dois telefones. A consulta entrega o mais recente primeiro,
    # entao vence o primeiro registro.
    resultado = coletar_contatos_b([
        RegistroB(telefone="47999990001", nome="Ana", rating="A", cpf="111.222.333-44"),
        RegistroB(telefone="47999990002", nome="Ana", rating="D", cpf="11122233344"),
    ])

    assert resultado.total_contatos == 1
    assert resultado.duplicados_cpf == 1
    assert resultado.grupos[GROUP_AMIGAVEL_A] == [("47999990001", "Ana")]
    assert resultado.grupos[GROUP_AMIGAVEL_D] == []


def test_dedup_cpf_ignora_cpf_vazio():
    # Sem CPF, cada telefone e independente.
    resultado = coletar_contatos_b([
        RegistroB(telefone="47999990001", nome="Ana", rating="A", cpf=""),
        RegistroB(telefone="47999990002", nome="Bia", rating="A", cpf=None),
    ])

    assert resultado.total_contatos == 2
    assert resultado.duplicados_cpf == 0


def test_duplicados_soma_as_duas_camadas():
    resultado = coletar_contatos_b([
        RegistroB(telefone="47999990001", nome="Ana", rating="A", cpf="1"),
        RegistroB(telefone="47999990001", nome="Ana", rating="A", cpf="1"),  # telefone repetido
        RegistroB(telefone="47999990002", nome="Ana", rating="A", cpf="1"),  # cpf repetido
    ])

    assert resultado.total_contatos == 1
    assert resultado.duplicados_telefone == 1
    assert resultado.duplicados_cpf == 1
    assert resultado.duplicados == 2


def test_rating_fora_da_lista_e_reportado():
    resultado = coletar_contatos_b([RegistroB(telefone="47999998888", nome="Ana", rating="B")])

    assert resultado.grupos[GROUP_OUTROS] == [("47999998888", "Ana")]
    assert resultado.ratings_desconhecidos["B"] == 1


def test_escreve_as_cinco_planilhas_mesmo_vazias(tmp_path):
    resultado = coletar_contatos_b([RegistroB(telefone="47999998888", nome="ANA", rating="D")])
    escrever_grupos_b(tmp_path, resultado.grupos)

    for arquivo in OUTPUT_FILES_B.values():
        assert (tmp_path / arquivo).exists()

    with (tmp_path / OUTPUT_FILES_B[GROUP_AMIGAVEL_D]).open(encoding="utf-8") as f:
        assert list(csv.reader(f, delimiter=";")) == [["phonenumber", "name"], ["47999998888", "Ana"]]
