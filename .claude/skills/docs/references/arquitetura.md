# Arquitetura

## O que o projeto faz

Cobrança da Porto por WhatsApp. Uma rodada de disparo produz cinco bases de contatos, cria lista de
distribuição + campanha + transmissão para cada uma no dashboard Jabuti, e agenda (ou envia) as
mensagens. O repo cobre a rodada inteira: do banco de dados até a transmissão criada.

**Isso dispara mensagem real para cliente real.** Qualquer caminho que rode `dispatch.js` apontando
para `out/` envia de verdade. O modo teste (`--bases-dir bases` / botão "teste" na tela) troca a
origem para `auto/bases/`, que tem um contato por base.

## As três metades

```
                     +------------------ app/ (tela) ------------------+
                     |  FastAPI + SSE; encadeia VPN -> base -> disparo  |
                     +--------+---------------------------+------------+
                              |                           |
                    chama in-process              subprocesso node
                              v                           v
  messagesdb  ----+   +---------------------+     +--------------------+
                  +-> |  geração (Python)   | --> |  disparo (auto/)   | --> dashboard.jabuti.ai
  b2bcustomers ---+   |  gerar_base.py      | CSV |  dispatch.js       |
                      +---------------------+     +--------------------+
                              |                           |
                              +-> relatorio/*.xlsx        +-> auto/logs/disparos.csv
```

1. **Geração** (Python, raiz) — lê dois Postgres, aplica as regras de elegibilidade, escreve cinco
   CSVs de duas colunas (`phonenumber,name`) em `out/`, mais um Excel de conferência.
   Detalhes: `geracao.md`.
2. **Disparo** (Node + Playwright, `auto/`) — lê esses CSVs e opera o dashboard pela interface.
   Detalhes: `disparo.md`.
3. **Tela** (`app/`) — junta as duas num fluxo de browser e transmite o progresso por SSE. Inclui o
   **agendador** (`app/agendador.py`): uma thread que dispara a pipeline inteira sozinha nos horários
   de `auto/config/agenda.json` enquanto o servidor estiver de pé. Detalhes: `app.md`.

As metades se falam por arquivo e por stdout, nunca por import. O que atravessa a fronteira está em
`contratos.md` — é a parte que quebra em silêncio quando só um lado muda.

## Fluxo de uma rodada (caminho normal, pela tela)

1. Operador abre `http://127.0.0.1:8000`, ajusta o número do template de cada base e o horário.
2. Tela chama `GET /api/executar` (SSE) e vira tela de progresso.
3. **VPN** — socket direto nos dois bancos; sem VPN para aqui, com mensagem legível.
4. **Base** — roda `gerar_base.gerar()` in-process, capturando o stdout como evento de log.
   Sem contato elegível, para aqui.
5. **Disparo** — `node auto/dispatch.js --hora HH:MM --bases-dir <pasta>` como subprocesso; a tela lê
   as linhas `[ETAPA] {json}` e desenha o progresso base a base.
6. **Fim** — resultado ok/erro, log técnico recolhido, histórico recarregado de `auto/logs/disparos.csv`.

Caminho de linha de comando: `python gerar_base.py` e depois `cd auto && node dispatch.js --hora HH:MM`.
Caminho manual (planilha pronta em vez de banco): `python extract.py`.

## Mapa de arquivos

| Caminho | Papel |
| --- | --- |
| `config.py` | Caminhos do projeto e leitura do `.env` |
| `banco.py` | Engines SQLAlchemy e as três consultas |
| `sql/` | As queries (`consulta_report`, `consulta_customer`, `consulta_novos`) |
| `gerar_base.py` | Pipeline banco → CSV (orquestrador + regras de elegibilidade) |
| `extract.py` | Pipeline Excel → CSV (caminho manual) |
| `contatos.py` | Núcleo compartilhado: normalização, rating, dedup, escrita dos CSVs |
| `app/server.py` | HTTP: validação, framing SSE, endpoints da agenda |
| `app/passos.py` | Os passos de verdade: VPN, geração, templates, disparo; a trava `LOCK_EXECUCAO` |
| `app/agendador.py` | Thread que dispara sozinha nos horários de `auto/config/agenda.json` |
| `app/static/` | Tela sem build (HTML/CSS/JS) |
| `auto/dispatch.js` | Orquestrador Playwright |
| `auto/lib/dispatch-logic.js` | Lógica pura, testável (`npm test`) |
| `auto/config/dispatches.json` | Configuração das cinco bases |
| `auto/config/agenda.json` | Modo + horários + templates dos disparos automáticos (`{modo, itens}`) |
| `auto/bases/` | Bases de teste, um contato cada (versionadas) |
| `tests/` | Suíte pytest do lado Python (`contatos.py`, `gerar_base.py`, `agendador.py`) |
| `filtros/` | Planilhas (xlsx/csv) com telefones a excluir das bases; lida a cada geração |
| `in/`, `out/`, `relatorio/`, `auto/logs/` | Dados, todos fora do versionamento |

## Decisões estruturais que valem entender

- **`contatos.py` é compartilhado de propósito.** É o único ponto onde regra de contato existe; os
  dois pipelines (banco e Excel) desembocam em `coletar_contatos()` → `escrever_grupos()`. Mexer lá
  muda os dois caminhos ao mesmo tempo — o que é o objetivo.
- **A tela não reimplementa nada.** `app/passos.py` captura o stdout do `gerar_base.py` e lê o stdout
  do `dispatch.js`. Por isso os dois continuam sendo CLIs que imprimem, e devem continuar sendo.
- **`auto/` é autocontido.** Todos os caminhos resolvem de `__dirname`, nunca do cwd, porque a tela o
  executa como subprocesso a partir de outra pasta.
- **Configuração fora do código.** Nome de base, CSV e template estão em `auto/config/dispatches.json`.
  Trocar template ou adicionar base não deve exigir mudança de código.
