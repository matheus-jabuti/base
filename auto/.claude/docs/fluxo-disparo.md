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
6. Monta um `estado` por entrada (`nome` já resolvido, `falhou: false`, `modo: null`).
   Base com CSV vazio já entra marcada `falhou: true` e é logada `pulado` sem passar por
   nenhuma fase.
7. Roda as 3 fases **em lote**, uma de cada vez, cada uma passando pelas 5 bases antes de
   ir pra próxima — não mais campanha→lista→transmissão por base, e sim campanha×5 →
   lista×5 → transmissão×5 (`rodarFase`, função interna de `main()`). Essa é a ordem que a
   equipe segue no dashboard manualmente; a transmissão vem por último porque precisa da
   campanha e da lista já criadas:
   - Dentro de uma fase, cada base ainda viva (`!estado.falhou`) roda uma vez; quem falhar
     entra numa lista de retry só dessa fase.
   - No fim da fase (depois das outras bases já terem passado), tenta de novo só quem
     falhou — o tempo gasto com as demais bases já serve de folga extra pra indexação/
     lentidão da plataforma, sem sleep artificial.
   - Falhou de nova, `estado.falhou = true` definitivo: grava `erro` no CSV, tira
     screenshot e a base **não entra mais em nenhuma fase seguinte** (ex.: falhou em criar
     a campanha, nunca chega a tentar lista nem transmissão).
   - Uma fase inteira nunca trava por causa de uma base — a próxima segue rodando pra
     quem ainda está vivo.
8. Login (passo 5) fica **fora** de qualquer `try/catch` por base — se falhar, `main()`
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
4. Salva a sessão nova em `scripts/out/auth.json` (reaproveitada nas próximas execuções e
   reescrita uma vez, depois das 3 fases, pra manter os cookies frescos).

## 2. Criar campanha (`createCampaign`)

1. `page.goto('https://dashboard.jabuti.ai/meta/campaigns/add')`
2. Preenche `input[name="name"]` com o nome montado (ex.: `Disparo amigavel C -
   12/08/2026 - 09H30`).
3. Preenche `textarea[name="description"]` com `by automação`.
4. Clica `Salvar Campanha`.
5. Espera o toast `Criada com sucesso` aparecer (`confirmSavedOrWarn`, timeout 30s) —
   essa tela **não redireciona** ao salvar, fica no mesmo formulário. Se o toast não
   aparecer mas também não há mensagem de erro visível na tela, só loga um aviso e
   segue (reenviar o formulário arriscaria criar campanha duplicada); se aparecer erro
   explícito, lança e a entrada vai pro log como `erro` sem criar lista/transmissão.
   A confirmação real de que a campanha existe acontece no passo 4 (retry de
   `fillBroadcastSelectors`).

## 3. Criar lista de distribuição (`createList`)

1. `page.goto('https://dashboard.jabuti.ai/meta/distribution-list/add')`
2. Preenche `input[name="name"]` com o mesmo nome da campanha.
3. Preenche `textarea[name="description"]` com `by automação`.
4. Sobe o arquivo de `config.csv` daquela entrada em `input[type="file"]`.
5. Espera o texto `Arquivo CSV validado com sucesso` aparecer (timeout 15s).
6. Clica `Salvar Lista de Distribuição`.
7. Espera o toast `Criada com sucesso` (`confirmSavedOrWarn`, timeout 30s), mesma lógica
   do passo 2.5 (aviso e segue se não houver toast nem erro; lança no erro explícito).

## 4. Criar transmissão (`createBroadcast`)

1. `fillBroadcastSelectors`: `page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add')`
   - Abre o combobox "Lista de distribuição", clica na opção cujo texto é
     `<nome> - (N registros)`. O regex vem de `listOptionRegex` em
     `lib/dispatch-logic.js` e aceita separador de milhar (`(1.153 registros)`) e o
     singular (`(1 registro)`); só `\d+` não bastava e derrubava qualquer base com mais
     de mil linhas.
   - Abre o combobox "Campanha", clica na opção com texto exatamente igual ao `<nome>`.
   - Abre o combobox "Template", clica na opção que casa `templateOptionRegex(template)`
     (`lib/dispatch-logic.js`): match **sem diferenciar maiúscula/minúscula**, ancorado nas
     pontas. A plataforma não padroniza a caixa (contencioso tem `WPP_contencioso_04` em
     minúsculo mas `WPP_CONTENCIOSO_01` em maiúsculo); o disparo só precisa do nome certo,
     não da caixa certa. A listbox também não renderiza tudo de cara — conforme a lista de
     templates cresce, opções mais abaixo só existem no DOM depois de rolar; a função rola
     em passos até a opção alvo ficar visível antes de clicar, e se não achar, o erro lista
     as opções disponíveis.
   - Tudo isso roda dentro de um retry: se a lista/campanha recém-criada ainda não
     aparecer na opção (indexação/processamento assíncrono do CSV no backend), recarrega
     a página `/meta/broadcasts/add` e tenta de novo — até 6 tentativas, ~10s de espera
     entre elas.
2. Preenche `input[name="name"]` e `textarea[name="description"]` (`by automação`) da
   própria transmissão.
3. Resolve o horário do agendamento (`horarioAgendamento`, `lib/dispatch-logic.js`) e
   **sempre agenda** — nunca envio imediato, pra sempre sobrar janela de cancelamento no
   dashboard. Se o horário escolhido no passo 0.3 ainda está a 10min ou mais no futuro
   nesse ponto do fluxo, agenda nele; se já passou ou está perto demais, agenda 10min
   pra frente (e loga `[agenda] "<nome>": ...`).
   - Clica `Agendar Transmissão`, espera o modal `Agendar Evento`, preenche `input#date`
     (YYYY-MM-DD) e `input#time` (HH:MM) com o horário resolvido, clica `Salvar Agendamento`.
4. `confirmModalIfPresent`: se a plataforma abrir o modal `Confirmar Envio` ("Você está
   prestes a enviar esta transmissão...") com os botões `Não` / `Sim, confirmar envio`,
   clica em `Sim, confirmar envio`. O modal é esperado por até 3s e ignorado se não
   aparecer — o caminho agendado hoje não mostra modal, a checagem fica só por segurança
   (o antigo envio imediato dependia dela).
5. `confirmBroadcastCreated`: espera, em paralelo, **ou** a URL voltar pra listagem de
   Transmissões (`/meta/broadcasts`, fora do `/add`) **ou** aparecer qualquer texto
   contendo "sucesso" na própria página — o que resolver primeiro decide. Se foi
   redirecionamento, ainda confirma que a linha da tabela com o `nome` apareceu. Sem
   nenhuma confirmação, lança erro.
   - Motivo de aceitar os dois casos: `Salvar Agendamento` redireciona pra listagem
     (confirmado em `scripts/out/60-after-settle.png` e em execução real); o toast fica
     como fallback caso a plataforma pare de redirecionar. (Histórico: o antigo envio
     imediato, sem o `Sim, confirmar envio` do passo 4, dava timeout aqui porque o envio
     nunca acontecia.)
   - Se der erro em qualquer etapa da criação da transmissão, `main()` tira um
     screenshot em `scripts/out/erro-<key>-<timestamp>.png` antes de logar — próxima
     falha real fica visível, sem precisar advinhar o que estava na tela.

## 5. Log (`logDispatch`)

Depois de cada uma das 5 entradas (sucesso ou erro), acrescenta uma linha em
`logs/disparos.csv`: data, horário-alvo, `key`, nome, modo (`agendado`, ou `-` quando a fase
`transmissao` ficou de fora), timestamp de execução, status (`ok`/`erro`), detalhe (mensagem de
erro se houver). `imediato` é valor legado — não sai mais, mas linhas antigas ainda têm.

## O que NÃO existe (de propósito, ver `CLAUDE.md` → "Known gaps")

- Sem checagem de nome duplicado — rodar duas vezes com a mesma data+horário cria
  campanha/lista duplicada (e a segunda tentativa de salvar falha, capturada pelo
  passo 2.5 / 3.7).
- Sem opção de reaproveitar uma lista de distribuição já existente — toda execução cria
  uma lista nova com o CSV configurado, mesmo em teste (decisão confirmada com o
  usuário: manter assim).
- Login só por usuário/senha, sem Microsoft SSO.
