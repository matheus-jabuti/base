# Tela (`app/`, FastAPI + JS sem build)

Caminho normal de uso: um menu para escolher template e horário, um clique que encadeia VPN → geração
→ disparo, e uma tela de progresso alimentada por SSE.

```bash
python -m app.server      # http://127.0.0.1:8000
```

## Camadas

| Arquivo | Responsabilidade |
| --- | --- |
| `app/server.py` | HTTP fino: validação de entrada, lock de execução única, framing SSE. Nenhuma regra. |
| `app/passos.py` | Os passos de verdade, um gerador por passo. Toda a lógica mora aqui. |
| `app/static/` | `index.html`, `style.css`, `app.js`. Sem build, sem dependência externa. |

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

## Front (`app/static/app.js`)

- Duas views no mesmo documento (`view-menu` / `view-progresso`), alternadas por `trocarView`. Cada
  view tem um wrapper `.colunas` (coluna principal + coluna lateral, grid a partir de 960px — abaixo
  disso empilha) desde o container ir para 1280px.
- O stepper de template edita só o número; o prefixo vem do servidor e vai de volta intacto.
- **Um stepper por grupo** (`agruparBases()` + mapa `GRUPOS`), não por base: as quatro amigáveis
  compartilham o número, o contencioso tem o dele. A linha mostra o total do grupo (detalhe por base
  no `title` do badge) e os prefixos distintos. `lerTemplates()` reexpande para uma entrada por base
  antes do `PUT`, repetindo o número do grupo e mandando o prefixo de cada uma.
- Antes de disparar: `PUT /api/templates` e um `confirm()` que diz quantos contatos **reais** vão sair
  e se vai agendar ou enviar agora (mensagem diferente em pré-visualização, ver abaixo).
- `disparar({dryRun})` monta a querystring de `/api/executar` com `dry_run`; o botão "Pré-visualizar"
  chama com `dryRun: true`, o "Disparar" sem.
- `EventSource` em `/api/executar`; o `onmessage` roteia por `tipo`: `passo` → trilha, `bases` →
  desenha as cinco linhas, `metrica` → `atualizarMetrica` (cards da coluna lateral, ver
  `contratos.md`), `etapa` (`base`/`login`/`plano`/`tempo`) → estado por base ou `atualizarTempo`,
  `log`/`erro` → log técnico, `fim` → `encerrar(status)` e recarrega o histórico. `status` de `fim` não
  é mais booleano: é `ok`/`erro`/`cancelado`/`pre-visualizacao`, cada um com texto e cor próprios
  (`TEXTOS_RESULTADO`).
- **Cancelar**: `#btn-cancelar` (visível só durante uma execução) chama `POST /api/cancelar` depois de
  um `confirm()` avisando que listas/campanhas já criadas podem ficar sem transmissão correspondente.
- **Filtro manual**: `#bloco-filtro` chama `GET /api/filtro` (`carregarFiltro`) ao expandir, mostrando
  arquivos e contagem de `filtros/` antes de rodar. Se a métrica `filtro` (evento `metrica`) veio com
  valor > 0 numa execução, `encerrar()` mostra um link de download pra
  `/api/filtro/ultimo-removido`.
- `agendado()` espelha o `decideMode` do `dispatch.js` (buffer de 2min) **apenas para avisar**; quem
  decide é o `dispatch.js`. Se o buffer mudar lá, mude aqui junto.
- Horário inicial: agora + 15 minutos. Período inicial: `/api/periodo-padrao`.
- Modo teste troca a faixa de aviso e recarrega as contagens da outra pasta.
- **Histórico**: `#historico-busca` (debounce 250ms) e `#historico-status` recarregam
  `carregarHistorico()` passando `busca`/`status` pra `/api/historico`.
- **Faixa de VPN** (`#faixa-vpn`, acima da faixa de modo): `verificarVpn()` roda no boot e chama
  `GET /api/vpn` até `VPN_TENTATIVAS` (3) vezes, com `VPN_ESPERA_MS` (1500ms) entre elas, **parando na
  primeira que responder `ok`** — quem conecta de primeira vê o verde direto. Esgotadas as tentativas,
  a faixa fica vermelha com o motivo por banco e o botão "Verificar de novo", que repete o ciclo. É só
  aviso: o bloqueio de verdade continua sendo o passo `vpn` do `executar()`, no backend.

## Ao mexer aqui

- Etapa nova visível na tela = um `progresso()` a mais no `dispatch.js` **e** tratamento no
  `app.js`; o contrato está em `contratos.md`.
- Mantenha `server.py` sem regra de negócio. Se precisar de lógica, ela vai para `passos.py`.
- Não reimplemente em JS nada que o backend já calcula, com a exceção consciente do `agendado()`.
