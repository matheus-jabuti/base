# Disparo (`auto/`, Node + Playwright)

Automação que opera o dashboard Jabuti pela interface, sem API. Este documento é a visão de
arquitetura; o **passo a passo literal** (URLs, seletores, ordem, timeouts) fica em
`auto/.claude/docs/fluxo-disparo.md`, e as lacunas intencionais em `auto/CLAUDE.md`.

## Divisão de responsabilidade

| Arquivo | Contém |
| --- | --- |
| `lib/dispatch-logic.js` | Lógica **pura**: formatação de data/hora, nome do disparo, nome do template, regex da opção de lista, regex da opção de template (`templateOptionRegex` — casa sem diferenciar caixa, ancorado nas pontas), `horarioAgendamento` (horário resolvido do agendamento), `parseFases` (normaliza `--fases`). Sem Playwright, sem rede, sem `fs`. |
| `lib/dispatch-logic.test.js` | Checagens com `assert`, rodadas por `npm test`. A suíte do lado Node — o lado Python tem a dele em `tests/` (`pytest`, ver `padroes.md`). |
| `dispatch.js` | Orquestração: browser, login, formulários, retries, log, códigos de saída. |
| `config/dispatches.json` | Estrutura das cinco bases (dados, não código) — **sem** o número do template. |
| `config/template-numeros.example.json` | Baseline `{grupo: "NN"}` versionado. |
| `config/template-numeros.json` | Número vivo por grupo. **Fora do versionamento** (semeado do `.example`). |
| `bases/*.csv` | Bases de teste, um contato cada — versionadas de propósito. |
| `logs/disparos.csv` | Uma linha por base por execução. Fora do versionamento. |

Regra: se dá para testar sem browser, vai para `lib/dispatch-logic.js` e ganha teste. Se precisa de
página, fica em `dispatch.js`.

## `config/dispatches.json` + o número do template

`dispatches.json` tem uma entrada por base, com `key`, `nome` (prefixo do nome do disparo), `csv`
(**só o nome do arquivo** — a pasta vem de `--bases-dir`), `grupo` e `template_prefix`. **Não** guarda
o número — ele muda quase toda rodada e sujava o git.

O número vive em `config/template-numeros.json` (gitignored), um `{ "<grupo>": "NN" }`. Se o arquivo
não existe, `dispatch.js:lerNumeros()` (e o lado Python, `passos._ler_numeros()`) o semeia de
`config/template-numeros.example.json` (versionado). Sem nenhum dos dois, cai em `"01"`.

`grupo` (`amigavel` / `amigavel_dez` / `contencioso`): as três bases amigáveis A/B/W, C e N/A Rating
saem com o mesmo número, a D/E/Z tem o dela e o contencioso o dele. `resolverBases` monta
`buildTemplateName(cfg.template_prefix, numeros[cfg.grupo] || '01')` — o template é prefixo + número
porque na prática só o número muda de rodada para rodada (`WPP_A_E_B_07` → `WPP_A_E_B_08`), aceitando
de 1 a 3 dígitos. **Não escreva o número atual em documentação** — leia o arquivo.

Adicionar, remover ou renomear base é edição de `dispatches.json`; não deve exigir mudança de código.

## Operação B (`--operacao b`)

Uma segunda operação de disparo, paralela à padrão (`--operacao a`, o default). **O disparo em si é
idêntico** — mesmas fases, mesmo login, mesmas confirmações, mesmo log. O que muda é só de onde sai a
configuração, no mapa `OPERACOES` no topo do `dispatch.js`:

| | `a` | `b` |
| --- | --- | --- |
| Estrutura das bases | `config/dispatches.json` | `config/dispatches-b.json` |
| Número do template | `config/template-numeros.json` | `config/template-numeros-b.json` |
| Baseline versionado | `template-numeros.example.json` | `template-numeros-b.example.json` |
| Pasta padrão de CSV | `../out` | `../out_b` |
| Bases de teste | `bases/` | `bases-b/` |

`--bases-dir` continua mandando quando é passado (é o que o modo teste usa); sem ele, cada operação
lê a própria pasta. As cinco entradas da B são separadas por rating, com o contencioso quebrado em
`menor_500`/`maior_500`, e **cada uma é o próprio `grupo`** — número de template independente por
planilha. O evento `plano` carrega `operacao` pra tela rotular a execução.

Não há agendador para a B: ela é disparada pela tela ou pela linha de comando, e o agendamento
acontece no dashboard como num disparo normal.

## Execução (`main()`)

1. Garante `logs/disparos.csv` (com header) e a pasta de `auth.json`.
2. `parseArgs`: `--hora HH:MM`, `--operacao a|b` (padrão `a`), `--bases-dir <pasta>` (padrão: a pasta
   da operação escolhida) e `--fases <lista>` (fases a
   criar, separadas por vírgula: `campanha`/`lista`/`transmissao`, qualquer ordem na linha de comando
   — rodam sempre nessa ordem; padrão as três, normalizado por `parseFases` — vazio ou nome
   desconhecido é erro). Argumento desconhecido, ou operação fora de `a`/`b`, é erro.
3. `resolverBases`: valida que a pasta e os cinco CSVs existem e conta os contatos **antes** de abrir o
   browser — CSV faltando falha cedo, e não no meio do disparo.
4. Sem `--hora`, pergunta no terminal. O horário vale para as cinco.
5. Emite `[ETAPA] {"evento":"plano", ...}` e abre o Chromium (`headless: true`).
6. Login (`ensureLoggedIn`) — **fora** do try/catch por base: falhou aqui, o processo inteiro cai.
7. Roda por **fase em lote**, não por base: todas as 5 campanhas, depois as 5 listas, depois as 5
   transmissões (`rodarFase`) — a ordem que a equipe segue no dashboard manualmente, com a transmissão
   por último porque precisa da campanha e da lista já criadas. Cada `rodarFase` só roda se a fase está
   em `--fases` — fase de fora é pulada por inteiro (nenhum evento `base` pra ela). Dentro de uma fase,
   quem falhar entra numa fila de retry só dessa fase e tenta de novo no final — depois das outras bases
   já terem passado, o que já dá folga de indexação sem precisar de sleep artificial. Falhou de novo, a
   base é marcada `falhou` (loga `erro`, tira screenshot) e some das fases seguintes — falhar na campanha
   significa nunca tentar lista nem transmissão. Uma base ruim nunca trava a fase para as outras.
8. Ao final, se houve qualquer erro, `process.exitCode = 1` — é assim que a tela sabe.
   Erro fatal imprime `[FATAL] <mensagem>` em uma linha só e sai com 1, sem stack trace cru.

Base com CSV de zero contatos já entra marcada `falhou` antes da primeira fase e é **pulada**
(`status: pulado`), não é erro: o dashboard rejeitaria o CSV vazio na validação.

## Sessão

`scripts/out/auth.json` guarda o `storageState`. Reaproveita se ainda válido (navega para o dashboard
com `domcontentloaded` — a tela tem polling, `networkidle` nunca resolve); se redirecionou para
sign-in, faz login com `JABUTI_EMAIL`/`JABUTI_PASSWORD` (com fallback para a conta de teste) e regrava.
A sessão é regravada uma vez, depois das 3 fases, para manter os cookies frescos.

Só existe login por usuário/senha. SSO Microsoft nunca foi implementado — decisão registrada em
`auto/CLAUDE.md` → "Known gaps".

## A lição que custou produção: confirme o resultado real

O dashboard **não** falha de forma visível. Um clique pode "dar certo" (sem exceção, `networkidle`
resolvido) sem ter salvo nada no servidor. Por isso cada etapa confirma um sinal concreto:

| Etapa | O que prova que funcionou |
| --- | --- |
| Campanha | Toast `Criada com sucesso` — a tela **não redireciona** ao salvar |
| Lista de distribuição | Mesmo toast, mesma lógica |
| Transmissão | Redirect para a listagem `/meta/broadcasts` **ou** texto com "sucesso"; havendo redirect, também a linha da tabela com o nome |

Casos reais que motivaram cada um estão em `auto/CLAUDE.md`. Dois merecem destaque porque voltam a
morder em qualquer etapa nova:

- **Modal de confirmação.** O antigo `Enviar Transmissão` (envio imediato, removido) abria
  `Confirmar Envio` e o envio só acontecia no `Sim, confirmar envio` — sem esse clique todas as cinco
  bases estouravam timeout. `confirmModalIfPresent` (esperado por 3s, ignorado se não aparecer)
  continua rodando no caminho agendado caso a plataforma passe a pedir confirmação lá também.
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

## Sempre agendado

Todo disparo é agendado (modal `Agendar Evento`, campos `#date` e `#time`) — **nunca** envio
imediato — pra sempre existir uma janela de cancelamento no dashboard antes da mensagem sair.
`horarioAgendamento(target, now, margem = 10min)`: se o horário alvo ainda está a 10min ou mais no
futuro, agenda nele; se já passou ou está perto demais, agenda `now + 10min` (e o `dispatch.js` loga
`[agenda] "<nome>": ...`). O cálculo roda **no momento de preencher o formulário**, não no início —
se o upload das listas demorou, o horário alvo pode já ter passado. A tela sempre mostra "agendado"
(`app/static/app.js:agendado`), avisando quando o horário será empurrado.

## Tempo por etapa

`formatDuracao` (`lib/dispatch-logic.js`, coberta por `npm test`) formata cada duração medida. Cada
ponto que já imprimia `[tempo] ...` como texto solto também emite `progresso({evento:'tempo', ...})`
estruturado, pra tela mostrar sem precisar fazer parsing de texto (`contratos.md` documenta os campos
por `escopo`): seleção lista/campanha/template, envio+confirmação e transmissão completa (por base,
dentro de `createBroadcast`); duração de cada fase (`rodarFase`); e o total do disparo, tanto no
caminho de sucesso quanto no `main().catch` de erro fatal (`interrompido: true`).

## Rastro

- Nome de lista, campanha e transmissão: `<nome da base> - DD/MM/AAAA - HHhMM` (`buildDispatchName`).
- Descrição dos três: `by automação` — é o que identifica o que veio da automação.
- Erro em uma base gera screenshot em `scripts/out/erro-<key>-<timestamp>.png`.
- `logs/disparos.csv`, colunas na ordem: `data`, `hora_alvo`, `tipo` (recebe a `key` da base), `nome`,
  `modo` (`agendado`, ou `-` quando a fase `transmissao` ficou de fora; `imediato` é legado, não sai mais), `hora_execucao` (ISO),
  `status` (`ok`/`erro`/`pulado`), `detalhe` (`fases: campanha, lista` quando não criou as três).
  Vírgula e quebra de linha do detalhe viram espaço — é CSV concatenado à mão, não há
  escaping; mantenha os campos livres de vírgula.
