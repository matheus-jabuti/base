"""Testes das regras de elegibilidade e periodo do pipeline via banco."""

from __future__ import annotations

from datetime import date

import pandas as pd

from gerar_base import (
    filtrar_elegiveis,
    montar_disparo,
    periodo_padrao,
    preparar_novos,
    remover_pagamento_recente,
)


def test_periodo_padrao_dia_comum_e_ontem_ate_hoje():
    terca = date(2026, 8, 18)
    assert periodo_padrao(terca) == (date(2026, 8, 17), terca)


def test_periodo_padrao_segunda_volta_ate_sexta():
    segunda = date(2026, 8, 17)
    assert periodo_padrao(segunda) == (date(2026, 8, 14), segunda)


def _df_final(**overrides):
    linha = {
        "telefone": "11912345678",
        "houve_interacao": "NAO",
        "bucket": "cobranca",
        "ind_baixa": pd.NA,
    }
    linha.update(overrides)
    return pd.DataFrame([linha])


def test_filtrar_elegiveis_mantem_quem_nao_interagiu():
    df = filtrar_elegiveis(_df_final(houve_interacao="NAO"))
    assert len(df) == 1


def test_filtrar_elegiveis_descarta_quem_interagiu():
    df = filtrar_elegiveis(_df_final(houve_interacao="SIM"))
    assert df.empty


def test_filtrar_elegiveis_descarta_bucket_bloqueado_ignorando_maiusculas():
    df = filtrar_elegiveis(_df_final(bucket="Pre-Cobranca"))
    assert df.empty

    df = filtrar_elegiveis(_df_final(bucket="Acima de 97"))
    assert df.empty


def test_filtrar_elegiveis_descarta_ind_baixa_bloqueado():
    df = filtrar_elegiveis(_df_final(ind_baixa="C"))
    assert df.empty

    df = filtrar_elegiveis(_df_final(ind_baixa="Q"))
    assert df.empty


def test_filtrar_elegiveis_mantem_ind_baixa_fora_da_lista_bloqueada():
    df = filtrar_elegiveis(_df_final(ind_baixa="A"))
    assert len(df) == 1


def test_montar_disparo_mantem_so_tipos_validos():
    df_elegiveis = pd.DataFrame(
        [
            {"telefone": "11912345678", "nome": "Joao", "tipo": "amigavel", "bucket": "cobranca", "rating": "A"},
            {"telefone": "11987654321", "nome": "NAO LOCALIZADO", "tipo": "NAO LOCALIZADO", "bucket": "cobranca", "rating": ""},
        ]
    )
    df_novos = pd.DataFrame(columns=df_elegiveis.columns)

    df_disparo = montar_disparo(df_elegiveis, df_novos)

    assert len(df_disparo) == 1
    assert df_disparo.iloc[0]["telefone"] == "11912345678"


def test_preparar_novos_remove_telefones_ja_em_uso():
    df_novos = pd.DataFrame(
        [
            {"telefone": "11912345678", "ind_baixa": pd.NA},
            {"telefone": "11987654321", "ind_baixa": pd.NA},
        ]
    )
    em_uso = pd.Series(["11912345678"])

    df = preparar_novos(df_novos, em_uso)

    assert df["telefone"].tolist() == ["11987654321"]


def test_remover_pagamento_recente_tira_telefones_bloqueados():
    df = pd.DataFrame(
        [
            {"telefone": "11912345678", "nome": "Joao"},
            {"telefone": "11987654321", "nome": "Maria"},
        ]
    )

    resultado = remover_pagamento_recente(df, {"11912345678"})

    assert resultado["telefone"].tolist() == ["11987654321"]


def test_remover_pagamento_recente_sem_bloqueio_devolve_igual():
    df = pd.DataFrame([{"telefone": "11912345678", "nome": "Joao"}])

    resultado = remover_pagamento_recente(df, set())

    assert resultado is df


def test_remover_pagamento_recente_df_vazio():
    df = pd.DataFrame(columns=["telefone"])

    resultado = remover_pagamento_recente(df, {"11912345678"})

    assert resultado.empty


def test_preparar_novos_remove_ind_baixa_bloqueado():
    df_novos = pd.DataFrame(
        [
            {"telefone": "11912345678", "ind_baixa": "C"},
            {"telefone": "11987654321", "ind_baixa": pd.NA},
        ]
    )
    em_uso = pd.Series([], dtype="object")

    df = preparar_novos(df_novos, em_uso)

    assert df["telefone"].tolist() == ["11987654321"]
