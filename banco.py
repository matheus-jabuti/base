"""Consultas aos bancos de mensagens e de clientes."""

from __future__ import annotations

from datetime import date
from functools import lru_cache

import pandas as pd
from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.engine import URL, Engine
from sqlalchemy.types import String

from config import SQL_DIR, env_port, require_env

COLUNAS_CUSTOMER = [
    "nome",
    "cpf",
    "telefone",
    "telefone_2",
    "telefone_3",
    "valor_princ",
    "tipo_telefone",
    "tipo",
    "ind_baixa",
    "data_vencimento",
    "dias_atraso",
    "bucket",
    "rating",
]


def build_engine(prefix: str) -> Engine:
    """Monta a engine a partir do bloco {prefix}_HOST/PORT/NAME/USER/PASSWORD.

    Usa URL.create para escapar as senhas, que contem caracteres especiais.
    """
    url = URL.create(
        "postgresql+psycopg2",
        username=require_env(f"{prefix}_USER"),
        password=require_env(f"{prefix}_PASSWORD"),
        host=require_env(f"{prefix}_HOST"),
        port=env_port(prefix),
        database=require_env(f"{prefix}_NAME"),
    )

    return create_engine(url)


def messages_engine() -> Engine:
    """Banco de logs de mensagem (messagesdb)."""
    return build_engine("DB")


def customers_engine() -> Engine:
    """Banco de clientes (b2bcustomers-db)."""
    return build_engine("CUSTOMERS_DB")


@lru_cache(maxsize=None)
def ler_sql(nome: str) -> str:
    return (SQL_DIR / nome).read_text(encoding="utf-8")


def _strip_colunas(df: pd.DataFrame, colunas: list[str]) -> pd.DataFrame:
    for col in colunas:
        if col in df.columns:
            df[col] = df[col].astype("string").str.strip()

    return df


def consultar_report(engine: Engine, data_inicio: date, data_fim: date, owner_id: str) -> pd.DataFrame:
    """Conversas do periodo, com telefone, interacao e tags."""
    df = pd.read_sql(
        text(ler_sql("consulta_report.sql")),
        con=engine,
        params={
            "data_inicio": data_inicio.strftime("%Y-%m-%d"),
            "data_fim": data_fim.strftime("%Y-%m-%d"),
            "owner_id": owner_id,
        },
        dtype="str",
    )

    return _strip_colunas(
        df,
        [
            "conversation_id",
            "telefone",
            "template_name",
            "campaign_alias",
            "tag_opcao_pagamento",
            "houve_interacao",
            "ultima_tag_valida",
            "tag_consulta_cliente_processa_dados",
        ],
    )


def consultar_novos(engine: Engine, data_inicio: date, data_fim: date) -> pd.DataFrame:
    """Clientes atualizados no periodo, ainda sem disparo."""
    df = pd.read_sql(
        text(ler_sql("consulta_novos.sql")),
        con=engine,
        params={
            "data_inicio": data_inicio.strftime("%Y-%m-%d"),
            "data_fim": data_fim.strftime("%Y-%m-%d"),
        },
        dtype="str",
    )

    return _strip_colunas(df, ["telefone", "telefone_2", "telefone_3", "ind_baixa", "cpf", "valor_princ", "rating", "tipo"])


def consultar_pagamento_recente(engine: Engine, data_inicio: date, data_fim: date, owner_id: str) -> pd.DataFrame:
    """Telefones que confirmaram opcao de pagamento no intervalo informado."""
    df = pd.read_sql(
        text(ler_sql("consulta_pagamento_recente.sql")),
        con=engine,
        params={
            "data_inicio": data_inicio.strftime("%Y-%m-%d"),
            "data_fim": data_fim.strftime("%Y-%m-%d"),
            "owner_id": owner_id,
        },
        dtype="str",
    )

    return _strip_colunas(df, ["telefone"])


def buscar_dados_customer(engine: Engine, telefones: list[str]) -> pd.DataFrame:
    """Dados cadastrais dos telefones informados.

    Um telefone pode estar em qualquer um dos campos de contato do cadastro,
    por isso a query procura em todos eles.
    """
    telefones = [str(tel).strip() for tel in telefones if tel is not None and str(tel).strip()]

    if not telefones:
        return pd.DataFrame(columns=COLUNAS_CUSTOMER)

    consulta = text(ler_sql("consulta_customer.sql")).bindparams(
        bindparam("telefones", value=telefones, type_=ARRAY(String))
    )

    df = pd.read_sql(consulta, con=engine, dtype="str")

    return _strip_colunas(
        df,
        ["telefone", "telefone_2", "telefone_3", "ind_baixa", "cpf", "valor_princ", "rating", "tipo"],
    )
