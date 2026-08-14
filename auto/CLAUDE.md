# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Working automation exists for one dispatch round: 5 bases dispatched together per run
(`Disparo amigavel A/B/W`, `Disparo amigavel C`, `Disparo amigavel D/E/Z`, `Disparo amigavel N/A Rating`,
`Disparo contencioso`). Earlier one-off exploration scripts live in `scripts/` (kept as reference —
`explore*.js`, `broadcast-fill*.js`, `rename*.js`, etc. — not part of the run path).

**This drives real WhatsApp dispatches on the live Jabuti/Porto platform.** `bases/*.csv` currently hold
a single test contact each — safe to run end-to-end for testing. Once real numbers are loaded, running
`npm run dispatch` sends/schedules for real.

## Architecture

Passo a passo literal de cada etapa (URLs, seletores, ordem exata): `.claude/docs/fluxo-disparo.md`.

- `lib/dispatch-logic.js` — pure functions: name formatting, HH:MM parsing, agendado-vs-imediato decision.
  No Playwright, no network — unit-testable in isolation.
- `lib/dispatch-logic.test.js` — assert-based self-check for the above (`npm test`).
- `config/dispatches.json` — one entry per base: `key`, `nome` (naming prefix), `csv`, `template`.
  Edit this file to change which template each base uses, or to add/remove bases — no code change needed.
- `dispatch.js` — orchestrator. Prompts once for the target time (HH:MM), reuses that time for all 5
  entries in `config/dispatches.json`, then for each: creates the distribution list (uploads the CSV),
  creates the campaign, creates the broadcast (list + campaign + template), and either schedules it
  (`Agendar Transmissão`) or sends it immediately (`Enviar Transmissão`) depending on whether the target
  time is still more than ~2 minutes away by the time the broadcast form is filled. All three created
  items (list/campaign/broadcast) get description `by automação` so they're identifiable as
  automation-created. Each of the 5 runs independently in a try/catch — one failing doesn't block the
  rest. Session: reuses `scripts/out/auth.json` if still valid, otherwise logs in with
  `JABUTI_EMAIL`/`JABUTI_PASSWORD` env vars (falls back to the known test account) and persists the new
  session.
- `logs/disparos.csv` — one row appended per base per run: date, target time, key, name, mode
  (agendado/imediato), execution timestamp, status (ok/erro), detail.

## Known gaps (intentionally not built — say if these are actually needed)

- Microsoft SSO login — no code path exists for it (only email/password), since no working example of
  that login form was ever captured. Skipped rather than guessed.
- No duplicate-name check before creating a list/campaign/broadcast — each run's name already embeds
  date+time, so same-day re-runs at a different time won't collide. Add a check if same-time re-runs
  become a real scenario.
- `config/dispatches.json` templates already replaced with real names (`WPP_A_E_B_07`, `WPP_rating_c_07`,
  `WPP_contencioso_07`) — no longer placeholders.

## Bugs found and fixed via real runs (not hypothetical — keep this pattern in mind for new steps)

Real test runs showed the platform doesn't always redirect or throw on failure — a click can "succeed"
(no exception, `networkidle` resolves) while nothing was actually saved server-side. Fixed by confirming
the actual UI outcome instead of trusting network idleness:

- List/campaign save: doesn't redirect on success, stays on the same `/add` form — only the `Criada com
  sucesso` toast proves it saved. Without checking for it, a rejected save (duplicate name, bad CSV) was
  silently treated as success, and the campaign got created pointing at a list that never existed.
- Broadcast (Agendar/Enviar Transmissão): redirects to the Transmissões listing on success — confirmed by
  waiting for that URL and for a table row containing the dispatch name. Without it, a failed send/schedule
  was logged as `ok` in `logs/disparos.csv` with nothing actually created (this happened in production:
  list + campaign created fine, transmissão never appeared).

- Immediate send: `Enviar Transmissão` only opens a `Confirmar Envio` modal — the actual send
  happens on `Sim, confirmar envio`. Without that click the form sat filled forever and
  `confirmBroadcastCreated` timed out on all 5 bases (see `scripts/out/erro-amigavel_*.png`).
  Handled by `confirmModalIfPresent`, which is also called on the scheduled path in case the
  platform starts asking there too.
- Distribution-list option text is `<nome> - (N registros)`, and N is thousands-separated above
  999 (`(1.153 registros)`). The old `\d+` regex silently only matched bases under 1000 rows —
  contencioso (1.153) failed all 6 retries while the four smaller bases matched. Regex now lives
  in `listOptionRegex` (`lib/dispatch-logic.js`), covered by `npm test`.

If a new step is added to `dispatch.js`, don't trust `waitForLoadState`/`waitForTimeout` alone as proof of
success — find the real signal (toast, redirect, row appearing) the same way, ideally from a captured
screenshot in `scripts/out/` before guessing.

## Requirements (original spec, `.claude/docs/README.md`)

- Log each dispatch: type, time, date performed. → `logs/disparos.csv`.
- Session handling: reuse login if already logged in; otherwise log in via Microsoft SSO or
  username/password. → username/password only (see gap above).
- After each dispatch, update progress in a CSV file. → `logs/disparos.csv`, appended per base.
- Flow: create campaign → upload distribution list → run dispatches. → per base:
  list → campaign → broadcast (schedule or send now).

## Working conventions

- Always use the `caveman` and `ponytail` skills for every task in this repo.
- Always update docs (`CLAUDE.md`, `.claude/docs/README.md`) when scope, architecture, or commands change.
