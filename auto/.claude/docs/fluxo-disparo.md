# Fluxo passo a passo — `dispatch.js`

Documentação literal do que o script faz, na ordem em que faz. Se o comportamento real
divergir disto, o código (`dispatch.js`) é a fonte da verdade — atualizar este arquivo
junto de qualquer mudança no código (ver `CLAUDE.md`, seção "Working conventions").

## 0. Início (`main()`)

1. Garante que `logs/disparos.csv` existe (cria com header se não existir).
2. Lê `config/dispatches.json` (5 entradas: `key`, `nome`, `csv`, `template`).
3. Pergunta no terminal: `Horário do disparo (HH:MM):` — uma vez, vale pros 5.
4. Abre o Chromium (`headless: true`).
5. Login (`ensureLoggedIn`) — ver seção 1.
6. Para cada uma das 5 entradas de `config/dispatches.json`, **em sequência** (não em
   paralelo), roda os passos 2, 3 e 4 abaixo dentro de um `try/catch` próprio — se uma
   entrada falhar, grava `erro` no CSV e segue pra próxima, não trava as outras 4.
7. Login (passo 1) fica **fora** desse try/catch por entrada — se falhar, `main()`
   inteiro rejeita, cai no `.catch` de topo, imprime `[FATAL] ...` numa linha só e
   sai com código 1, em vez de derrubar o processo com stack trace cru.

## 1. Login (`ensureLoggedIn`)

1. Se existe `scripts/out/auth.json`, abre contexto do browser com essa sessão salva e
   navega para `https://dashboard.jabuti.ai/meta/campaigns/manage` (`domcontentloaded`,
   não `networkidle` — essa tela tem dado vivo/polling e a rede nunca fica ociosa;
   já deu timeout de 30s em teste real por causa disso).
2. Se a URL não redirecionou pra sign-in, sessão válida — segue com essa `page`.
3. Se redirecionou (ou não havia `auth.json`): abre `https://auth.jabuti.ai/sign-in`,
   preenche `#email`/`#password` (env vars `JABUTI_EMAIL`/`JABUTI_PASSWORD`, com
   fallback pra conta de teste), clica `Entrar`, espera saída da URL de sign-in.
4. Salva a sessão nova em `scripts/out/auth.json` (reaproveitada nas próximas execuções
   e reescrita depois de cada uma das 5 entradas, pra manter os cookies frescos).

## 2. Criar lista de distribuição (`createList`)

1. `page.goto('https://dashboard.jabuti.ai/meta/distribution-list/add')`
2. Preenche `input[name="name"]` com o nome montado (ex.: `Disparo amigavel C -
   12/08/2026 - 09H30`).
3. Preenche `textarea[name="description"]` com `by automação`.
4. Sobe o arquivo de `config.csv` daquela entrada em `input[type="file"]`.
5. Espera o texto `Arquivo CSV validado com sucesso` aparecer (timeout 15s).
6. Clica `Salvar Lista de Distribuição`.
7. Espera o toast `Criada com sucesso` aparecer (timeout 15s) — essa tela **não
   redireciona** ao salvar, fica no mesmo formulário; o toast é o único jeito confiável
   de confirmar que persistiu. Se não aparecer, lança erro (nome duplicado, CSV
   rejeitado etc.) e a entrada vai pro log como `erro` sem criar campanha/transmissão.

## 3. Criar campanha (`createCampaign`)

1. `page.goto('https://dashboard.jabuti.ai/meta/campaigns/add')`
2. Preenche `input[name="name"]` com o mesmo nome da lista.
3. Preenche `textarea[name="description"]` com `by automação`.
4. Clica `Salvar Campanha`.
5. Espera o toast `Criada com sucesso` (timeout 15s), mesma lógica do passo 2.7.

## 4. Criar transmissão (`createBroadcast`)

1. `fillBroadcastSelectors`: `page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add')`
   - Abre o combobox "Lista de distribuição", clica na opção cujo texto é
     `<nome> - (N registros)`. O regex vem de `listOptionRegex` em
     `lib/dispatch-logic.js` e aceita separador de milhar (`(1.153 registros)`) e o
     singular (`(1 registro)`); só `\d+` não bastava e derrubava qualquer base com mais
     de mil linhas.
   - Abre o combobox "Campanha", clica na opção com texto exatamente igual ao `<nome>`.
   - Abre o combobox "Template", clica na opção com o `template` configurado pra essa
     entrada.
   - Tudo isso roda dentro de um retry: se a lista/campanha recém-criada ainda não
     aparecer na opção (indexação/processamento assíncrono do CSV no backend), recarrega
     a página `/meta/broadcasts/add` e tenta de novo — até 6 tentativas, ~10s de espera
     entre elas.
2. Preenche `input[name="name"]` e `textarea[name="description"]` (`by automação`) da
   própria transmissão.
3. Decide agendado vs imediato (`decideMode`, `lib/dispatch-logic.js`): se o horário
   escolhido no passo 0.3 ainda está a mais de ~2min no futuro nesse ponto do fluxo,
   agenda; senão, envia na hora.
   - **Agendado**: clica `Agendar Transmissão`, espera o modal `Agendar Evento`,
     preenche `input#date` (YYYY-MM-DD) e `input#time` (HH:MM), clica
     `Salvar Agendamento`.
   - **Imediato**: clica `Enviar Transmissão`.
4. `confirmModalIfPresent`: a plataforma abre o modal `Confirmar Envio` ("Você está
   prestes a enviar esta transmissão...") com os botões `Não` / `Sim, confirmar envio`.
   Sem clicar em `Sim, confirmar envio` nada é enviado e o passo 5 estoura o timeout.
   O modal é esperado por até 5s e ignorado se não aparecer (o caminho agendado hoje não
   mostra modal).
5. `confirmBroadcastCreated`: espera, em paralelo, **ou** a URL voltar pra listagem de
   Transmissões (`/meta/broadcasts`, fora do `/add`) **ou** aparecer qualquer texto
   contendo "sucesso" na própria página — o que resolver primeiro decide. Se foi
   redirecionamento, ainda confirma que a linha da tabela com o `nome` apareceu. Sem
   nenhuma confirmação, lança erro.
   - Motivo de aceitar os dois casos: `Salvar Agendamento` redireciona pra listagem
     (confirmado em `scripts/out/60-after-settle.png` e em execução real). O modo
     imediato, depois do `Sim, confirmar envio` do passo 4, também passa nessa
     confirmação — antes do passo 4 existir, todas as tentativas em modo imediato davam
     timeout aqui (a agendada passava tranquila), porque o envio nunca chegou a
     acontecer.
   - Se der erro em qualquer etapa da criação da transmissão, `main()` tira um
     screenshot em `scripts/out/erro-<key>-<timestamp>.png` antes de logar — próxima
     falha real fica visível, sem precisar advinhar o que estava na tela.

## 5. Log (`logDispatch`)

Depois de cada uma das 5 entradas (sucesso ou erro), acrescenta uma linha em
`logs/disparos.csv`: data, horário-alvo, `key`, nome, modo (`agendado`/`imediato`/`-`),
timestamp de execução, status (`ok`/`erro`), detalhe (mensagem de erro se houver).

## O que NÃO existe (de propósito, ver `CLAUDE.md` → "Known gaps")

- Sem checagem de nome duplicado — rodar duas vezes com a mesma data+horário cria lista/
  campanha duplicada (e a segunda tentativa de lista falha, capturada pelo passo 2.7).
- Sem opção de reaproveitar uma lista de distribuição já existente — toda execução cria
  uma lista nova com o CSV configurado, mesmo em teste (decisão confirmada com o
  usuário: manter assim).
- Login só por usuário/senha, sem Microsoft SSO.
