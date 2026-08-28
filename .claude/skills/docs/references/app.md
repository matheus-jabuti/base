# Tela (`app/`, FastAPI + JS sem build)

Caminho normal de uso: quatro abas fixas (Preparar / Agenda / Monitorar / Histórico), um painel de
revisão antes do disparo, e o acompanhamento ao vivo alimentado por SSE — que, ao terminar, vira a
tela de resultado. A aba **Agenda** gerencia a lista de disparos automáticos; quem dispara é a thread
do `app/agendador.py` (ver "Agendador" abaixo), não a tela.

```bash
python -m app.server      # http://127.0.0.1:8000
```

## Camadas

| Arquivo | Responsabilidade |
| --- | --- |
| `app/server.py` | HTTP fino: validação de entrada, lock de execução única, framing SSE. Nenhuma regra. |
| `app/passos.py` | Os passos de verdade, um gerador por passo. Toda a lógica mora aqui. |
| `app/agendador.py` | Thread que dispara sozinha nos horários de `auto/config/agenda.json`. |
| `app/static/` | `index.html`, `style.css`, `app.js`. Sem build, sem dependência externa. |

A trava de execução única mora em `passos.LOCK_EXECUCAO` (não mais em `server.py`): a tela
(`server._sse`) e o agendador (`agendador._disparar_item`) a compartilham, então só há um disparo
rodando de cada vez, venha da tela ou do horário.

`app/passos.py` insere a raiz do projeto no `sys.path` para importar `config` e `gerar_base`, que ficam
um nível acima. Os imports desses módulos são **dentro das funções**, de propósito: o servidor sobe
mesmo sem `.env` preenchido.

## Endpoints

| Método e rota | O que faz |
| --- | --- |
| `GET /` | Serve `index.html` |
| `GET /api/vpn` | Testa os dois bancos, devolve `{ok, conexoes[]}` |
| `GET /api/templates` | Conteúdo de `auto/config/dispatches.json` |
| `PUT /api/templates` | Regrava **apenas** `template_prefix` e `template_numero` |
| `GET /api/bases?modo=` | Por base: nome, csv, template montado, contatos, se o CSV existe |
| `GET /api/periodo-padrao` | Reusa `gerar_base.periodo_padrao()` |
| `GET /api/executar` | O botão único — SSE com a execução inteira. Aceita `dry_run=true` (exige `gerar=true`) |
| `POST /api/cancelar` | Sinaliza cancelamento da execução em andamento. `409` se não há nenhuma rodando |
| `GET /api/filtro` | Arquivos, contagem e lista dos telefones (`numeros`) em `filtros/`, sem precisar de VPN/DB |
| `GET /api/filtro/ultimo-removido` | Download do CSV mais recente de removidos pelo filtro (`relatorio/filtro_removidos_*.csv`); `404` se nenhum existe |
| `GET /api/historico?limite=&busca=&status=&modo=` | Últimas linhas de `auto/logs/disparos.csv`, mais recente primeiro, com filtro opcional |
| `GET /api/agenda` | A agenda com a situação calculada de cada item (`agendador.agenda_para_tela()`) |
| `PUT /api/agenda` | Regrava a agenda inteira (`[{data, hora, ativo, templates}]`); valida formato, horário repetido e template por grupo, ordena, poda o estado órfão |
| `GET /api/agenda/status` | Estado do agendador: `ligado`, `desde`, `em_execucao`, `proximo`, `tolerancia_min`, `antecedencia_min` |
| `POST /api/agenda/rearmar` | `{id}` — tira o item do estado pra ele poder disparar de novo (item que falhou ou se perdeu) |

Validações em `server.py`: `hora` no formato `HH:MM` com faixa válida (normalizada para dois dígitos),
`modo` restrito às chaves de `passos.BASES_DIR`, datas em `AAAA-MM-DD` com início ≤ fim, `dry_run=true`
sem `gerar=true` é `400` (pré-visualizar sem gerar base não faz sentido).

**Lock de execução única**: um `threading.Lock` global; geração e disparo mexem nos mesmos CSVs, e dois
cliques em paralelo dariam base pela metade ou disparo duplicado. Segunda chamada concorrente responde
`erro` + `fim {status: "ocupado"}` e encerra. `/api/cancelar` verifica esse mesmo lock (`.locked()`)
para saber se há algo a cancelar.

**Cancelamento**: `passos.cancelar()` seta um `threading.Event` a nível de módulo e, se o passo
`disparo` estiver rodando, mata o subprocesso `node` (`taskkill /PID .../T /F` no Windows, pra levar
junto o Chromium filho do Playwright — `_matar_processo`). Durante a geração da base (thread Python),
o cancelamento **não é instantâneo**: só surte efeito no próximo `_checar_cancelamento` dentro de
`gerar_base.py`, entre chamadas de DB (ver `contratos.md` e `geracao.md`). `executar()` termina com
`("fim", {"status": "cancelado"})` em qualquer um dos dois pontos.

## Os passos (`app/passos.py`)

Cada passo é um gerador que produz tuplas `(tipo, dado)`; `server.py` só as embrulha em SSE.

- **`checar_vpn()`** — abre socket (`timeout` 4s) no host/porta de cada banco, os mesmos que o
  SQLAlchemy usaria. Sem VPN a falha aparece em segundos e legível, em vez de um traceback de psycopg2.
- **`gerar_base(..., dry_run=False)`** — roda `gerar_base.gerar()` numa thread, com o `stdout`
  redirecionado para `_FilaDeLinhas`, que quebra o texto em linhas e enfileira como evento `log` (ou
  `metrica`, se a linha tiver o prefixo `[METRICA] `, ver `contratos.md`). Nada da lógica de geração é
  duplicada aqui. `OperacaoCancelada` vira evento `("cancelado", True)`; ao final emite `("total", n)`
  e, em dry-run, também `("grupos_previa", {grupo: contagem})`.
- **`contagens_previa(modo, grupos_previa)`** — mesma forma de `contagens()`, mas a partir do
  `grupos_previa` em memória de um dry-run (nada foi gravado em disco), usando
  `contatos.CSV_PARA_GRUPO` pra mapear `csv` → grupo.
- **`filtro_atual()` / `ultimo_arquivo_filtro_removidos()`** — dados por trás de `/api/filtro` e
  `/api/filtro/ultimo-removido`.
- **`disparar(hora, modo)`** — `subprocess.Popen` do `node dispatch.js`, lendo o stdout linha a linha.
  Linha com o prefixo `[ETAPA] ` vira evento `etapa` com o JSON já decodificado (inclusive o novo
  evento `tempo`, ver `contratos.md`); linha começando com `[ERRO]`/`[FATAL]` vira `erro`; o resto vira
  `log`. `returncode != 0` emite `falhou`; cancelado via `_matar_processo` emite `("cancelado", True)`.
  Node ausente no PATH é tratado antes de tentar.
- **`executar(..., dry_run=False)`** — encadeia os passos e **para na primeira falha, no cancelamento,
  ou (em dry-run) após a prévia** — sem VPN não adianta gerar, sem base não adianta disparar. Emite
  `("passo", {id, status, detalhe})` a cada troca de etapa (`vpn`, `base`, `disparo`; status
  `rodando`/`ok`/`erro`/`pulado`/`cancelado`) e fecha com `("fim", {status})`, onde `status` é
  `ok`/`erro`/`cancelado`/`pre-visualizacao`. Em dry-run, pula o disparo inteiro.
- **`cancelar()`** — usado por `POST /api/cancelar` (ver acima).
- **`gravar_templates(...)`** — valida prefixo não vazio e número de 1 a 3 dígitos, aplica `zfill(2)` e
  regrava o JSON. `key`, `nome` e `csv` são estrutura, não configuração: nunca vêm da tela.
- **`contar_csv` / `contagens(modo)`** — contam linhas não vazias menos o cabeçalho, na pasta do modo.
- **`ultimos_disparos(limite, busca, status, modo)`** — filtros aplicados **antes** do corte por
  `limite`, senão a busca só enxergaria as últimas N linhas em vez do log inteiro.

`BASES_DIR` define os dois modos: `producao` → `out/`, `teste` → `auto/bases/`. É o único lugar onde
essa escolha existe; a tela só manda o nome do modo.

## Agendador (`app/agendador.py`)

Uma thread daemon, iniciada em `server.main()` (só no caminho `python -m app.server`). De
`INTERVALO_TICK_S` em `INTERVALO_TICK_S` segundos (30) confere `auto/config/agenda.json` e, quando um
item chega na hora, roda `passos.executar(...)` inteiro (VPN → base → disparo) em `modo="producao"`,
`gerar=True`, com o período de `gerar_base.periodo_padrao()` calculado na hora e a `hora` do próprio
item passada adiante (é ela que nomeia lista/campanha/transmissão e decide agendado × imediato no
`dispatch.js`).

- **`agenda.json`** — lista de `{data: "AAAA-MM-DD", hora: "HH:MM", ativo: bool, templates: {grupo:
  "NN"}}`. Editada só pela aba Agenda (`PUT /api/agenda`). O id de um item é `"data hora"` — mexer no
  horário cria um item novo. `templates` é obrigatório e tem um número (1 a 3 dígitos, `zfill(2)`) por
  grupo de `passos.grupos_templates()` (hoje `amigavel` e `contencioso`, a mesma divisão dos steppers
  de Preparar). Antes de cada disparo, `_aplicar_templates` grava esses números no `dispatches.json`
  via `passos.gravar_templates` — cada base mantém o próprio prefixo, só o número (compartilhado pelo
  grupo) vem da linha da agenda. Item sem `templates` completo é registrado como `erro` e não dispara.
- **Estado** — `auto/logs/agenda_estado.json` (`{id: {situacao, quando, detalhe}}`), fora do
  versionamento como todo o resto de `auto/logs/`. Sobrevive a restart: item já disparado não roda de
  novo, item perdido não dispara atrasado.
- **`ANTECEDENCIA_MIN`** (0) — dispara este tanto de minutos antes do horário. 0 = na hora exata, o
  que sempre cai em envio imediato no `dispatch.js`. Acima de ~2 viraria agendamento na plataforma.
- **`TOLERANCIA_ATRASO_MIN`** (20) — servidor desligado ou ocupado no horário: passou disso da hora
  sem disparar, o item vira `perdido` e não roda mais. Dentro da janela, dispara no próximo tick.
- **Um disparo por ciclo** — `_disparar_item` bloqueia por minutos; o ciclo seguinte relê o estado e
  pega o próximo item. Se a trava `passos.LOCK_EXECUCAO` estiver tomada (disparo manual), sai e tenta
  no próximo ciclo.
- **Decisão pura e testada** — `situacao_do_item`, `itens_a_disparar`, `proximo_disparo` não têm IO;
  `tests/test_agendador.py` cobre. O resto lê/grava arquivo e roda a pipeline.
- **Sem view ao vivo** — um disparo automático não aparece na aba Monitorar (não há broker de SSE
  para um cliente que conecta no meio); a aba Agenda mostra "disparo automático rodando" via
  `GET /api/agenda/status` e o resultado fica no histórico e no `agenda_estado.json`.

## Front (`app/static/app.js`)

- **Quatro views no mesmo documento** (`view-preparar` / `view-agenda` / `view-monitorar` /
  `view-historico`), trocadas por `irPara(aba)`, que sincroniza o `location.hash`, marca a aba ativa,
  recarrega o histórico ao entrar nele e, ao entrar/sair de Agenda, liga/desliga o poll de status
  (`entrarAgenda` / `pararPollAgenda`). `window.onhashchange` chama o mesmo `irPara`, e o boot entra
  pela hash da URL. Preparar, Agenda e Monitorar usam o wrapper `.colunas` (coluna principal + lateral
  fixa de 300px, grid a partir de 980px — abaixo disso empilha).
- **Aba Agenda**: `estado.agenda = { itens, sujo, grupos }` é a cópia de trabalho. `grupos` (rótulo +
  número atual por grupo) vem de `GET /api/templates` em `carregarGruposAgenda`, e monta os campos de
  template do formulário de adicionar e de cada linha. Adicionar/remover/ativar linha e digitar
  número de template é local e liga `sujo`; os inputs de template usam `oninput` **sem redesenhar** (a
  linha inteira redesenharia e perderia o foco). "Salvar agenda" faz `PUT /api/agenda` mandando
  `[{data, hora, ativo, templates}]` e substitui a cópia pela resposta. "Re-armar" (só para item que
  falhou/perdeu, e só com a agenda salva) é um `POST /api/agenda/rearmar` imediato. Enquanto a aba
  está aberta, um poll de 15s atualiza a lateral (`GET /api/agenda/status`) e, se não houver edição
  pendente, recarrega as linhas.
- **Contexto sempre visível**: barra superior fixa (`position: sticky`) com marca, abas, chip de VPN
  (clicável, refaz a checagem), segmento de modo e alternador de tema; logo abaixo, a faixa de modo.
  A aba Monitorar ganha um ponto pulsante (`#ponto-monitorar`) enquanto há execução rodando.
- **Tema**: claro por padrão, escuro por `prefers-color-scheme`, e `data-tema` no `<html>` quando o
  usuário escolhe explicitamente (`alternarTema` cicla claro → escuro → sistema, guardado em
  `localStorage`). Toda cor sai de token em `:root`; nenhuma cor é definida só dentro do media query.
  `[hidden] { display: none !important; }` é obrigatório: vários blocos têm `display` próprio
  (grid/flex) e ganhariam do `[hidden]` do navegador.
- Uma linha por base em Preparar, com barra de volume proporcional ao maior CSV e o rótulo
  `contatos` / `CSV vazio` / `sem CSV`. Base vazia continua listada (o `dispatch.js` espera os cinco
  arquivos).
- O stepper de template edita só o número; o prefixo vem do servidor e vai de volta intacto.
- **Um número por grupo** (`grupoDaBase()` + mapa `GRUPOS`), mesmo com uma linha por base: mexer no
  stepper (ou digitar no campo) de uma amigável replica nas outras do grupo; o contencioso tem o dele.
  `lerTemplates()` monta uma entrada por base antes do `PUT`, repetindo o número do grupo e mandando o
  prefixo de cada uma.
- **Painel de revisão** (`#painel-revisao`) no lugar do `confirm()` do navegador: `abrirRevisao(dryRun)`
  monta o modo, o título com o total, o horário resolvido (agendado/imediato), a mini-tabela
  base · template · contatos e a checklist de `montarChecklist()` — VPN, período da geração (ou aviso
  de que está reaproveitando CSVs), telefones do filtro manual, bases vazias e o aviso de que o
  agendamento só é desfeito no dashboard. Nenhuma verificação nova: tudo vem do que já está em memória
  (`estado.vpn`, `estado.filtro`, `estado.bases`).
- **Segurar para disparar**: em produção (e fora do dry-run), `#btn-confirmar` só confirma depois de
  `SEGURAR_MS` (1500ms) de `pointerdown`/`keydown` — `iniciarSegurar` anima a fita e agenda
  `confirmarRevisao`; soltar, sair do botão ou `Escape` chama `abortarSegurar`. Em teste e em
  pré-visualização o mesmo botão vira um clique só (classe `.simples`).
- `executar(dryRun)` faz o `PUT /api/templates` e monta a querystring de `/api/executar` com `dry_run`;
  "Pré-visualizar sem gravar" chama com `true`, "Revisar e disparar" com `false`.
- `EventSource` em `/api/executar`; o `onmessage` roteia por `tipo`: `passo` → trilha, `bases` →
  `desenharSubbases` (também popula `estado.execucao.bases`), `metrica` → `atualizarMetrica` (cards da
  coluna lateral, ver `contratos.md`), `etapa` (`base`/`login`/`plano`/`tempo`) → estado por base ou
  `atualizarTempo`, `log`/`erro` → log técnico, `fim` → `encerrar(status)`. `status` de `fim` é
  `ok`/`erro`/`cancelado`/`pre-visualizacao`, cada um com texto, ícone e cor próprios.
- **Estado da execução** vive em `estado.execucao` (início, hora, modo, dryRun, `bases` como `Map`,
  métricas de filtro, tempo total). É o que permite sair da aba e voltar sem perder nada, e é a fonte
  da tela de resultado.
- **Etapas por base**: cada `<li>` das sub-bases mostra os chips `lista`/`campanha`/`transmissao`
  (`pintarSubbase`) — os anteriores à etapa atual ficam `ok`, o atual `rodando`. Base sem contatos
  mostra `CSV vazio`; em dry-run os chips somem e a situação vira `prévia`.
- **Cronômetro e fita de progresso**: `iniciarCronometro()` conta o tempo decorrido de segundo em
  segundo; `calcularProgresso()` vai de 15% (VPN) a 45% (base gerada) e daí proporcional às bases já
  concluídas.
- **Resultado** (`desenharResultado` / `desenharPorBase` / `desenharArquivos`): frase de fechamento com
  quantas bases foram agendadas ou enviadas, tabela por base (template, contatos, tempo, status) e os
  arquivos da execução — link pra `/api/filtro/ultimo-removido` quando a métrica `filtro` veio > 0,
  relatório e contagem de linhas do log.
- **Cancelar**: `#btn-cancelar` (visível só durante uma execução) chama `POST /api/cancelar` depois de
  um `confirm()` avisando que listas/campanhas já criadas podem ficar sem transmissão correspondente.
- **Filtro manual**: `carregarFiltro()` roda no boot (`GET /api/filtro`) e alimenta tanto o resumo
  lateral quanto a checklist da revisão; o chip "Filtro manual" abre o modal com os números.
- `agendado()` espelha o `decideMode` do `dispatch.js` (buffer de 2min) **apenas para avisar**; quem
  decide é o `dispatch.js`. Se o buffer mudar lá, mude aqui junto.
- Horário inicial: agora + 15 minutos. Período inicial: `/api/periodo-padrao`.
- Modo teste troca a faixa de aviso e recarrega as contagens da outra pasta.
- **Histórico** (aba própria, não mais modal): `#historico-busca` (debounce 250ms), `#historico-status`,
  `#historico-modo` e `#historico-limite` recarregam `carregarHistorico()`, que passa
  `busca`/`status`/`modo`/`limite` pra `/api/historico` e conta linhas/ok/erro no topo. `modo` aqui é
  `agendado`/`imediato` (o que o `dispatch.js` grava), não produção/teste. `nomeDaBase()` tira o
  sufixo `- dd/mm/aaaa - HHhMM` do nome da campanha e `horaCurta()` reduz o ISO de `hora_execucao` ao
  relógio local.
- **Chip de VPN** (`#chip-vpn`, na barra do topo): `verificarVpn()` roda no boot e chama
  `GET /api/vpn` até `VPN_TENTATIVAS` (3) vezes, com `VPN_ESPERA_MS` (1500ms) entre elas, **parando na
  primeira que responder `ok`** — quem conecta de primeira vê o verde direto. Esgotadas as tentativas,
  o chip fica vermelho com o motivo por banco e clicar nele repete o ciclo. O resultado fica em
  `estado.vpn` e alimenta a checklist da revisão. É só aviso: o bloqueio de verdade continua sendo o
  passo `vpn` do `executar()`, no backend.

## Ao mexer aqui

- Etapa nova visível na tela = um `progresso()` a mais no `dispatch.js` **e** tratamento no
  `app.js`; o contrato está em `contratos.md`.
- Mantenha `server.py` sem regra de negócio. Se precisar de lógica, ela vai para `passos.py`.
- Não reimplemente em JS nada que o backend já calcula, com a exceção consciente do `agendado()`.
- Cor semântica não se mistura com acento: vermelho só onde há consequência imediata (faixa de
  produção, painel de confirmação, botão de segurar, status de erro), acento só para o que é
  interativo. Status nunca é só cor — sempre tem rótulo escrito.
- Bloco novo com `display` próprio precisa continuar respeitando `[hidden]` (a regra global já cobre,
  não a remova).
