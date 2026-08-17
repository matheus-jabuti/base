# Disparo (`auto/`, Node + Playwright)

Automação que opera o dashboard Jabuti pela interface, sem API. Este documento é a visão de
arquitetura; o **passo a passo literal** (URLs, seletores, ordem, timeouts) fica em
`auto/.claude/docs/fluxo-disparo.md`, e as lacunas intencionais em `auto/CLAUDE.md`.

## Divisão de responsabilidade

| Arquivo | Contém |
| --- | --- |
| `lib/dispatch-logic.js` | Lógica **pura**: formatação de data/hora, nome do disparo, nome do template, regex da opção de lista, decisão agendado × imediato. Sem Playwright, sem rede, sem `fs`. |
| `lib/dispatch-logic.test.js` | Checagens com `assert`, rodadas por `npm test`. É a única suíte do repo. |
| `dispatch.js` | Orquestração: browser, login, formulários, retries, log, códigos de saída. |
| `config/dispatches.json` | As cinco bases (dados, não código). |
| `bases/*.csv` | Bases de teste, um contato cada — versionadas de propósito. |
| `logs/disparos.csv` | Uma linha por base por execução. Fora do versionamento. |

Regra: se dá para testar sem browser, vai para `lib/dispatch-logic.js` e ganha teste. Se precisa de
página, fica em `dispatch.js`.

## `config/dispatches.json`

Uma entrada por base, com `key`, `nome` (prefixo do nome do disparo), `csv` (**só o nome do arquivo** —
a pasta vem de `--bases-dir`), `template_prefix` e `template_numero`.

O template é quebrado em prefixo + número porque na prática só o número muda de rodada para rodada
(`WPP_A_E_B_07` → `WPP_A_E_B_08`). `buildTemplateName` junta os dois com `pad2`, aceitando de 1 a 3
dígitos. A tela edita só o número. **Não escreva o número atual em documentação** — leia o arquivo.

Adicionar, remover ou renomear base é edição deste arquivo; não deve exigir mudança de código.

## Execução (`main()`)

1. Garante `logs/disparos.csv` (com header) e a pasta de `auth.json`.
2. `parseArgs`: `--hora HH:MM` e `--bases-dir <pasta>` (padrão `../out`). Argumento desconhecido é erro.
3. `resolverBases`: valida que a pasta e os cinco CSVs existem e conta os contatos **antes** de abrir o
   browser — CSV faltando falha cedo, e não no meio do disparo.
4. Sem `--hora`, pergunta no terminal. O horário vale para as cinco.
5. Emite `[ETAPA] {"evento":"plano", ...}` e abre o Chromium (`headless: true`).
6. Login (`ensureLoggedIn`) — **fora** do try/catch por base: falhou aqui, o processo inteiro cai.
7. Para cada base, **em sequência**, dentro de try/catch próprio: lista → campanha → transmissão.
   Uma falha registra `erro` e segue para a próxima.
8. Ao final, se houve qualquer erro, `process.exitCode = 1` — é assim que a tela sabe.
   Erro fatal imprime `[FATAL] <mensagem>` em uma linha só e sai com 1, sem stack trace cru.

Base com CSV de zero contatos é **pulada** (`status: pulado`), não é erro: o dashboard rejeitaria o
CSV vazio na validação.

## Sessão

`scripts/out/auth.json` guarda o `storageState`. Reaproveita se ainda válido (navega para o dashboard
com `domcontentloaded` — a tela tem polling, `networkidle` nunca resolve); se redirecionou para
sign-in, faz login com `JABUTI_EMAIL`/`JABUTI_PASSWORD` (com fallback para a conta de teste) e regrava.
A sessão é regravada depois de cada base para manter os cookies frescos.

Só existe login por usuário/senha. SSO Microsoft nunca foi implementado — decisão registrada em
`auto/CLAUDE.md` → "Known gaps".

## A lição que custou produção: confirme o resultado real

O dashboard **não** falha de forma visível. Um clique pode "dar certo" (sem exceção, `networkidle`
resolvido) sem ter salvo nada no servidor. Por isso cada etapa confirma um sinal concreto:

| Etapa | O que prova que funcionou |
| --- | --- |
| Lista de distribuição | Toast `Criada com sucesso` — a tela **não redireciona** ao salvar |
| Campanha | Mesmo toast, mesma lógica |
| Transmissão | Redirect para a listagem `/meta/broadcasts` **ou** texto com "sucesso"; havendo redirect, também a linha da tabela com o nome |

Casos reais que motivaram cada um estão em `auto/CLAUDE.md`. Dois merecem destaque porque voltam a
morder em qualquer etapa nova:

- **Envio imediato abre modal.** `Enviar Transmissão` só abre `Confirmar Envio`; o envio acontece no
  `Sim, confirmar envio` (`confirmModalIfPresent`, esperado por 5s e ignorado se não aparecer). Sem
  esse clique, todas as cinco bases estouravam timeout.
- **A opção da lista tem separador de milhar.** O texto é `<nome> - (1.153 registros)`; um `\d+`
  ingênuo casava só com bases abaixo de mil. O regex vive em `listOptionRegex` e é coberto por teste.

**Ao adicionar uma etapa nova: `waitForLoadState` e `waitForTimeout` não são prova de sucesso.** Ache
o sinal real (toast, redirect, linha aparecendo), de preferência olhando um screenshot capturado em
`scripts/out/` antes de adivinhar.

## Retry de indexação

Lista e campanha recém-criadas levam um tempo para ficarem selecionáveis no formulário de transmissão
(processamento assíncrono do CSV). `createBroadcast` recarrega `/meta/broadcasts/add` e tenta de novo,
até 6 vezes com ~10s de intervalo, emitindo progresso a cada tentativa. Esgotado, o erro nomeia as
tentativas.

## Agendado × imediato

`decideMode(target, now, buffer = 2min)`: mais de ~2 minutos de folga → agenda (modal `Agendar Evento`,
campos `#date` e `#time`); abaixo disso → envia na hora. A decisão é tomada **no momento de preencher
o formulário**, não no início — se o upload das listas demorou, o horário alvo pode já ter passado.
A tela espelha esse cálculo só para avisar o operador (`app/static/app.js:agendado`); a decisão real é
sempre do `dispatch.js`.

## Rastro

- Nome de lista, campanha e transmissão: `<nome da base> - DD/MM/AAAA - HHhMM` (`buildDispatchName`).
- Descrição dos três: `by automação` — é o que identifica o que veio da automação.
- Erro em uma base gera screenshot em `scripts/out/erro-<key>-<timestamp>.png`.
- `logs/disparos.csv`, colunas na ordem: `data`, `hora_alvo`, `tipo` (recebe a `key` da base), `nome`,
  `modo` (`agendado`/`imediato`/`-`), `hora_execucao` (ISO), `status` (`ok`/`erro`/`pulado`),
  `detalhe`. Vírgula e quebra de linha do detalhe viram espaço — é CSV concatenado à mão, não há
  escaping; mantenha os campos livres de vírgula.
