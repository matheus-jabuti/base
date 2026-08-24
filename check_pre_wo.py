"""Ad-hoc: valida se telefones de contencioso_pre_wo.csv ja tiveram interacao
ou fecharam acordo (tag tran_confirmar_opcao_pagamento*), pra evitar redisparo.

Uso: python check_pre_wo.py
"""
from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
from sqlalchemy import text

from banco import messages_engine
from config import load_env, owner_id

load_env()

CSV_PATH = Path(__file__).parent / "contencioso_pre_wo.csv"

with CSV_PATH.open(encoding="utf-8") as f:
    reader = csv.DictReader(f, delimiter=";")
    telefones = [row["phonenumber"].strip() for row in reader if row.get("phonenumber", "").strip()]

print(f"Telefones na base: {len(telefones)}")

sql = text("""
    SELECT
        RIGHT(COALESCE(ml.metadata->>'phone_number', ml."phoneNumber"), 11) AS telefone,
        ml."conversationId" AS conversation_id,
        ml."createdAt" AS created_at,
        ml."totalTokens" AS total_tokens,
        EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(ml.metadata->'tags', '[]'::jsonb)) t
            WHERE t->>'tag' LIKE 'tran_confirmar_opcao_pagamento%'
        ) AS acordo_fechado
    FROM public.message_logs ml
    WHERE ml."ownerId" = :owner_id
      AND RIGHT(COALESCE(ml.metadata->>'phone_number', ml."phoneNumber"), 11) = ANY(:telefones)
    ORDER BY telefone, ml."createdAt"
""")

engine = messages_engine()
df = pd.read_sql(sql, con=engine, params={"owner_id": owner_id(), "telefones": telefones})

if df.empty:
    print("Nenhum dos telefones tem historico em message_logs. Base limpa pra disparo.")
else:
    resumo = (
        df.groupby("telefone")
        .agg(
            interacoes=("conversation_id", "nunique"),
            houve_interacao=("total_tokens", lambda s: "SIM" if s.notna().any() else "NAO"),
            acordo_fechado=("acordo_fechado", "any"),
            ultima_interacao=("created_at", "max"),
        )
        .reset_index()
    )

    bloquear = resumo[(resumo["houve_interacao"] == "SIM") | (resumo["acordo_fechado"])]

    print(f"Telefones com algum registro no messagesdb: {len(resumo)}")
    print(f"Telefones a BLOQUEAR (interagiram ou fecharam acordo): {len(bloquear)}")
    print()
    print(bloquear.to_string(index=False))

    out_path = Path(__file__).parent / "contencioso_pre_wo_bloqueados.csv"
    bloquear.to_csv(out_path, index=False, sep=";")
    print(f"\nSalvo em: {out_path}")
