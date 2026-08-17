# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Generates the WhatsApp dispatch bases for Porto debt collection and fires them on the Jabuti
dashboard. Three halves that chain into one pipeline:

1. **Generation** (Python, repo root) — reads two Postgres databases, applies eligibility rules,
   writes five two-column CSVs (`phonenumber,name`) to `out/` plus `copy.md` and an Excel report.
2. **Dispatch** (Node + Playwright, `auto/`) — takes those CSVs and drives the dashboard UI to
   create distribution list → campaign → broadcast, per base. Has its own `auto/CLAUDE.md`
   — **read it before touching anything under `auto/`**.
3. **UI** (`app/`, FastAPI + vanilla JS) — a four-step browser flow that runs 1 and 2 in sequence
   and streams progress over SSE.

`../` is a workspace of independent repos (see `../CLAUDE.md` for the Porto tools repo). This repo
is self-contained; the parent's Porto-tools guidance does not apply here.

**This fires real WhatsApp messages to real customers.** Anything that runs `dispatch.js` against
`out/` sends for real. Test mode (`--bases-dir bases` / "modo teste" in the UI) swaps the source to
`auto/bases/`, which holds one contact per base.

## Commands

```bash
pip install -r requirements.txt
cp .env.example .env                 # DB credentials, OWNER_ID — never committed
cd auto && npm install && npx playwright install chromium

python -m app.server                 # UI at http://127.0.0.1:8000 (normal path)

python gerar_base.py                 # DB → out/*.csv  (default period: yesterday→today; Monday→last Friday)
python gerar_base.py --data-inicio 2026-08-01 --data-fim 2026-08-10 --hora 17H --sem-relatorio --sem-copy
python extract.py                    # manual path: in/*.xlsx (sheets TempA/TempB) → out/*.csv

cd auto && npm test                  # the only test suite: assert-based checks of lib/dispatch-logic.js
cd auto && node dispatch.js --hora 14:30 [--bases-dir bases]
```

Both DBs are only reachable over the company VPN. `app/passos.py:checar_vpn` probes them with a raw
socket first so the failure is a readable message instead of a psycopg2 traceback — do the same for
any new DB-touching step.

## Architecture

### Generation pipeline

`gerar_base.py` is the orchestrator; `banco.py` owns SQL/engines (`sql/*.sql`, read via `ler_sql`);
`contatos.py` owns every contact-level rule and is the **shared core between both entry points**
(`gerar_base.py` from the DB, `extract.py` from Excel). Both funnel into `coletar_contatos()` →
`escrever_grupos()`, so a change to normalization, grouping, or dedup automatically applies to both.

Flow: conversations in period (messagesdb) → drop anyone with a `tag_opcao_pagamento` → enrich from
the customer registry (b2bcustomers-db, matched on `telefone`/`telefone_2`/`telefone_3` via
`montar_lookup`) → keep `houve_interacao == "NAO"`, drop blocked buckets (`pre-cobranca`,
`Acima de 97`) and `ind_baixa` in `C`/`Q` → add new customers of the period not already present →
keep only `tipo` in (`amigavel`, `contencioso`).

Grouping (`contatos.py`): contencioso ignores rating; amigável is grouped by the **first letter** of
the rating (`A/B/W`, `C`, `D/E/Z`), so prefixed values like `Z_REDUCAO` and `W_FPD_COM_PL` land
correctly. Unknown or empty rating goes to the `sem_rating` group and is reported as a warning rather
than raising. Dedup is **global by phone** across all groups — one number gets exactly one dispatch —
and phones under 10 digits are dropped as undialable.

`out/` is wiped (`clear_output_folder`, `.gitkeep` preserved) and rewritten on every run — all five
CSVs are always written, empty ones included, because `dispatch.js` expects the files to exist.

### The contract between the halves

- **CSV set**: `OUTPUT_FILES` in `contatos.py` and the `csv` fields in `auto/config/dispatches.json`
  must stay in sync — adding/renaming a base means editing both, plus `auto/bases/` for test mode.
- **`copy.md`**: campaign names (`CAMPAIGN_LABELS` + date + hour) — the same names `dispatch.js`
  builds via `buildDispatchName`. Both must agree or the operator's copy won't match what was created.
- **Progress protocol**: `dispatch.js` writes `[ETAPA] {json}` lines on stdout (`progresso()`);
  `app/passos.py:disparar` parses those and treats every other line as free-form log. Events:
  `plano`, `login`, `base` (`rodando` with `etapa` of lista/campanha/transmissao, then
  `ok`/`erro`/`pulado`). Adding a UI-visible step = one more `progresso()` call plus handling in
  `app/static/app.js`.
- **Time**: one `HH:MM` drives everything — `copy.md`, campaign names, and the schedule. More than
  ~2 min out it's scheduled, otherwise sent immediately (`decideMode`).

### UI

`app/server.py` is thin: validation, a global `threading.Lock` so only one run happens at a time, and
SSE framing. All real work is in `app/passos.py`, one generator per step yielding `(tipo, dado)`
tuples; `executar()` chains VPN → base → dispatch and **stops at the first failure**. Generation
reuses `gerar_base.gerar()` as-is by capturing its stdout (`_FilaDeLinhas`) rather than duplicating
logic — keep `gerar_base.py` print-based so this keeps working. `app/static/` is plain HTML/CSS/JS,
no build step. Template editing writes back only `template_prefix`/`template_numero` into
`auto/config/dispatches.json`; `key`/`nome`/`csv` are structure, not configuration.

## Conventions

- Code, comments, docstrings, and CLI output are **in Portuguese without accents** (Python side);
  `auto/` uses Portuguese with accents in strings. Match the file you're editing.
- Config over code: templates, base names, and CSV names live in `auto/config/dispatches.json`.
  Prefer editing it over touching `dispatch.js`.
- Keep the pure/impure split in `auto/lib/dispatch-logic.js` — anything unit-testable goes there
  (it's what `npm test` covers), Playwright and network stay in `dispatch.js`.
- Paths in `dispatch.js` resolve from `__dirname`, never the cwd, because the UI spawns it as a
  subprocess. Same rule for anything new it calls.
- Per `auto/CLAUDE.md`: never trust `waitForLoadState`/`waitForTimeout` as proof a dashboard action
  succeeded — confirm the real signal (success toast, redirect, row appearing). Several production
  failures came from exactly that.
- Update `README.md` (operator-facing, Portuguese) and `auto/CLAUDE.md` when flow, commands, or
  output files change.

## Reference

- `README.md` — operator manual: eligibility rules, CLI flags, output table.
- `auto/CLAUDE.md` — dispatch architecture, known gaps, bugs found in real runs.
- `auto/.claude/docs/fluxo-disparo.md` — literal step-by-step of the dashboard flow (URLs, selectors, order).
