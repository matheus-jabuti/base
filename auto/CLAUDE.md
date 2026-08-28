# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Working automation exists for one dispatch round: 5 bases dispatched together per run
(`Disparo amigavel A/B/W`, `Disparo amigavel C`, `Disparo amigavel D/E/Z`, `Disparo amigavel N/A Rating`,
`Disparo contencioso`). The one-off exploration scripts that used to live in `scripts/`
(`explore*.js`, `broadcast-fill*.js`, `rename*.js`, etc. — never part of the run path) were removed;
their history is still in git if a past selector/flow needs checking. `scripts/out/` remains — it's
runtime state (session `auth.json`, error screenshots), not exploration code.

This folder lives inside the `base` repo, which also holds the Python pipeline that produces the CSVs
(`../gerar_base.py` → `../out/`) and the web UI that drives both (`../app/`). See `../README.md`.

**This drives real WhatsApp dispatches on the live Jabuti/Porto platform.** By default `dispatch.js`
reads the real bases from `../out/`. `bases/*.csv` hold a single test contact each and are the
test-mode source — pass `--bases-dir bases` (or flip "modo teste" in the UI) to run end-to-end safely.

## Architecture

Passo a passo literal de cada etapa (URLs, seletores, ordem exata): `.claude/docs/fluxo-disparo.md`.

- `lib/dispatch-logic.js` — pure functions: name formatting, HH:MM parsing, agendado-vs-imediato decision.
  No Playwright, no network — unit-testable in isolation.
- `lib/dispatch-logic.test.js` — assert-based self-check for the above (`npm test`).
- `config/dispatches.json` — one entry per base: `key`, `nome` (naming prefix), `csv` (file name only —
  the folder comes from `--bases-dir`), `template_prefix` and `template_numero`. The template name is
  built as `<prefix>_<numero>` (`buildTemplateName`), because in practice only the trailing number
  changes between rounds — the UI edits that number without retyping the whole name. Edit this file to
  change templates or to add/remove bases — no code change needed.
- `config/agenda.json` — **not read by `dispatch.js`**. Horários dos disparos automáticos
  (`[{data, hora, ativo}]`), gerenciados pela aba Agenda da tela e disparados pela thread
  `app/agendador.py`. Vive aqui só por proximidade com `dispatches.json`; runtime state fica em
  `logs/agenda_estado.json`.
- `dispatch.js` — orchestrator. Takes the target time from `--hora HH:MM` (falls back to a terminal
  prompt when the flag is absent) and the CSV folder from `--bases-dir` (default `../out`), reuses that
  time for all 5 entries in `config/dispatches.json`. Runs **phase-batched, not per-base**: creates all 5
  distribution lists (uploads each CSV), then all 5 campaigns, then all 5 broadcasts (list + campaign +
  template, scheduled via `Agendar Transmissão` or sent immediately via `Enviar Transmissão` depending on
  whether the target time is still more than ~2 minutes away by the time the broadcast form is filled).
  All three created items (list/campaign/broadcast) get description `by automação` so they're
  identifiable as automation-created. Within each phase, a base that fails goes on a retry list and gets
  one more attempt at the end of that phase — after the other bases have already run, which doubles as
  natural indexing delay before the retry, no artificial sleep added. Still failing after that retry
  marks the base `falhou` for good: logs `erro`, screenshots, and the base is excluded from every
  subsequent phase (fails at list creation → never attempts campaign or broadcast). One base's failure
  never blocks a phase for the rest — but the process exits non-zero if anything failed, so the UI can
  tell. A base whose CSV has zero contacts is marked `falhou` up front and logged `pulado` without
  entering any phase. Session: reuses `scripts/out/auth.json` if still valid, otherwise logs in with
  `JABUTI_EMAIL`/`JABUTI_PASSWORD` env vars (falls back to the known test account) and persists the new
  session once after all 3 phases finish. All paths are resolved from `__dirname`, not the cwd, because
  the UI spawns this as a subprocess. Progress is reported on stdout as `[ETAPA] {json}` lines
  (`progresso()`) — events `plano` (the 5 bases about to run), `login`, `base` (per base: `rodando`
  with an `etapa` of lista/campanha/transmissao — optionally `detalhe: 'retentando apos as outras bases'`
  on the end-of-phase retry — then `ok`/`erro`/`pulado`), and `tempo` (timing, emitted alongside every
  existing `[tempo] ...` console.log — `escopo: base|fase|total`, `ms`, `duracao` already formatted by
  `formatDuracao`; see `../.claude/skills/docs/references/contratos.md` for the field table). The UI
  parses those and leaves every other line as free-form log, so adding a new step means emitting one
  more `progresso()` call.
- `logs/disparos.csv` — one row appended per base per run: date, target time, key, name, mode
  (agendado/imediato), execution timestamp, status (ok/erro/pulado), detail. Gitignored.

## Known gaps (intentionally not built — say if these are actually needed)

- Microsoft SSO login — no code path exists for it (only email/password), since no working example of
  that login form was ever captured. Skipped rather than guessed.
- No duplicate-name check before creating a list/campaign/broadcast — each run's name already embeds
  date+time, so same-day re-runs at a different time won't collide. Add a check if same-time re-runs
  become a real scenario.
- `config/dispatches.json` templates already hold real prefixes (`WPP_A_E_B`, `WPP_rating_c`,
  `WPP_contencioso`) — no longer placeholders. The trailing number changes every round, so read the
  file for the current value instead of trusting a number written down here.
- No check that the chosen template actually exists on the platform. A wrong number fails late, when
  `fillBroadcastSelectors` can't find the option — after list and campaign were already created.

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
- Template dropdown doesn't render every option up front — as the template list grows (contencioso
  passed 10 entries), options further down (e.g. `WPP_contencioso_01`) aren't in the DOM until the
  listbox is scrolled, so `getByRole('option', ...).click()` timed out even with the right name in
  `config/dispatches.json` (recurring across separate runs — `scripts/out/erro-contencioso-*.png`).
  Fixed by `clickTemplateOption` in `dispatch.js`, which scrolls the listbox in steps until the
  target option is visible before clicking.
- `createList`/`createCampaign` had no tolerance for a slow "Criada com sucesso" toast — one instance
  where the form was filled and validated correctly but the toast alone didn't render in 15s aborted
  the whole base immediately (`scripts/out/erro-amigavel_abw-*.png`). Resubmitting the form isn't
  safe (risk of a duplicate list/campaign with the same name), so `confirmSavedOrWarn` instead waits
  longer (30s) and only throws if an explicit error message is visible; if neither toast nor error
  shows up, it logs a warning and moves on — `createBroadcast`'s own retry loop is what actually
  confirms the list/campaign exists when selecting them for the broadcast.

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
- Repo-wide documentation lives in the `docs` skill at `../.claude/skills/docs/` — `references/disparo.md`
  covers this folder's architecture, and `references/contratos.md` covers what `dispatch.js` shares with
  the Python pipeline and the UI (`[ETAPA]` protocol, CSV set, exit codes). Update those too when the
  change crosses that boundary.
