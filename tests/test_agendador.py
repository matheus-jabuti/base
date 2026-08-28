"""Testes da logica de decisao do agendador (funcoes puras, sem IO nem thread)."""

from __future__ import annotations

from datetime import datetime

import pytest

from app.agendador import (
    alvo_do_item,
    id_do_item,
    itens_a_disparar,
    proximo_disparo,
    situacao_do_item,
)


def item(data="2026-09-01", hora="15:30", ativo=True):
    return {"data": data, "hora": hora, "ativo": ativo}


def test_id_do_item_e_data_mais_hora():
    assert id_do_item(item()) == "2026-09-01 15:30"


def test_alvo_do_item_desconta_a_antecedencia():
    assert alvo_do_item(item(), antecedencia_min=0) == datetime(2026, 9, 1, 15, 30)
    assert alvo_do_item(item(), antecedencia_min=15) == datetime(2026, 9, 1, 15, 15)


# ------------------------------------------------------------- situacao

def test_situacao_desativado_quando_inativo():
    agora = datetime(2026, 9, 1, 15, 0)
    assert situacao_do_item(item(ativo=False), {}, agora) == "desativado"


def test_situacao_agendado_antes_da_hora():
    agora = datetime(2026, 9, 1, 15, 0)
    assert situacao_do_item(item(), {}, agora) == "agendado"


def test_situacao_pendente_logo_apos_a_hora_dentro_da_janela():
    agora = datetime(2026, 9, 1, 15, 40)
    assert situacao_do_item(item(), {}, agora, tolerancia_min=20) == "pendente"


def test_situacao_perdido_passada_a_tolerancia():
    agora = datetime(2026, 9, 1, 16, 0)
    assert situacao_do_item(item(), {}, agora, tolerancia_min=20) == "perdido"


def test_situacao_vem_do_estado_quando_ja_rodou():
    agora = datetime(2026, 9, 1, 16, 0)
    estado = {"2026-09-01 15:30": {"situacao": "disparado"}}
    assert situacao_do_item(item(), estado, agora) == "disparado"

    estado = {"2026-09-01 15:30": {"situacao": "erro"}}
    assert situacao_do_item(item(), estado, agora) == "erro"


# ------------------------------------------------------------- itens_a_disparar

def test_nada_a_fazer_antes_da_hora():
    agora = datetime(2026, 9, 1, 15, 0)
    assert itens_a_disparar([item()], {}, agora) == []


def test_dispara_na_hora():
    agora = datetime(2026, 9, 1, 15, 31)
    resultado = itens_a_disparar([item()], {}, agora, tolerancia_min=20)
    assert resultado == [(item(), "disparar")]


def test_perde_quando_passou_da_tolerancia():
    agora = datetime(2026, 9, 1, 16, 5)
    resultado = itens_a_disparar([item()], {}, agora, tolerancia_min=20)
    assert resultado == [(item(), "perder")]


def test_ignora_item_ja_no_estado():
    agora = datetime(2026, 9, 1, 15, 31)
    estado = {"2026-09-01 15:30": {"situacao": "disparado"}}
    assert itens_a_disparar([item()], estado, agora) == []


def test_ignora_item_desativado():
    agora = datetime(2026, 9, 1, 15, 31)
    assert itens_a_disparar([item(ativo=False)], {}, agora) == []


def test_antecedencia_adianta_o_disparo():
    agora = datetime(2026, 9, 1, 15, 16)
    resultado = itens_a_disparar([item()], {}, agora, antecedencia_min=15, tolerancia_min=20)
    assert resultado == [(item(), "disparar")]


# ------------------------------------------------------------- proximo_disparo

def test_proximo_disparo_pega_o_mais_cedo_ainda_por_rodar():
    agora = datetime(2026, 9, 1, 8, 0)
    itens = [item(hora="20:00"), item(hora="15:30"), item(data="2026-08-30", hora="09:00")]

    proximo = proximo_disparo(itens, {}, agora)

    assert proximo["id"] == "2026-09-01 15:30"
    assert proximo["em_minutos"] == 7 * 60 + 30


def test_proximo_disparo_none_quando_tudo_ja_rodou_ou_passou():
    agora = datetime(2026, 9, 1, 21, 0)
    estado = {"2026-09-01 15:30": {"situacao": "disparado"}}
    assert proximo_disparo([item(hora="15:30")], estado, agora) is None


def test_proximo_disparo_ignora_inativo():
    agora = datetime(2026, 9, 1, 8, 0)
    assert proximo_disparo([item(hora="15:30", ativo=False)], {}, agora) is None
