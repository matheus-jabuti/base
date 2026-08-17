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
| `GET /api/executar` | O botão único — SSE com a execução inteira |
| `GET /api/historico?limite=` | Últimas linhas de `auto/logs/disparos.csv`, mais recente primeiro |

Validações em `server.py`: `hora` no formato `HH:MM` com faixa válida (normalizada para dois dígitos),
`modo` restrito às chaves de `passos.BASES_DIR`, datas em `AAAA-MM-DD` com início ≤ fim.

**Lock de execução única**: um `threading.Lock` global; geração e disparo mexem nos mesmos CSVs, e dois
cliques em paralelo dariam base pela metade ou disparo duplicado. Segunda chamada concorrente responde
`erro` + `fim {status: "ocupado"}` e encerra.

## Os passos (`app/passos.py`)

Cada passo é um gerador que produz tuplas `(tipo, dado)`; `server.py` só as embrulha em SSE.

- **`checar_vpn()`** — abre socket (`timeout` 4s) no host/porta de cada banco, os mesmos que o
  SQLAlchemy usaria. Sem VPN a falha aparece em segundos e legível, em vez de um traceback de psycopg2.
- **`gerar_base(...)`** — roda `gerar_base.gerar()` numa thread, com o `stdout` redirecionado para
  `_FilaDeLinhas`, que quebra o texto em linhas e enfileira como evento `log`. Nada da lógica de
  geração é duplicado aqui; ao final emite `("total", n)`.
- **`disparar(hora, modo)`** — `subprocess.Popen` do `node dispatch.js`, lendo o stdout linha a linha.
  Linha com o prefixo `[ETAPA] ` vira evento `etapa` com o JSON já decodificado; linha começando com
  `[ERRO]`/`[FATAL]` vira `erro`; o resto vira `log`. `returncode != 0` emite `falhou`. Node ausente no
  PATH é tratado antes de tentar.
- **`executar(...)`** — encadeia os três e **para na primeira falha**: sem VPN não adianta gerar, sem
  base não adianta disparar. Emite `("passo", {id, status, detalhe})` a cada troca de etapa
  (`vpn`, `base`, `disparo`; status `rodando`/`ok`/`erro`/`pulado`) e fecha com `("fim", {status})`.
- **`gravar_templates(...)`** — valida prefixo não vazio e número de 1 a 3 dígitos, aplica `zfill(2)` e
  regrava o JSON. `key`, `nome` e `csv` são estrutura, não configuração: nunca vêm da tela.
- **`contar_csv` / `contagens(modo)`** — contam linhas não vazias menos o cabeçalho, na pasta do modo.

`BASES_DIR` define os dois modos: `producao` → `out/`, `teste` → `auto/bases/`. É o único lugar onde
essa escolha existe; a tela só manda o nome do modo.

## Front (`app/static/app.js`)

- Duas views no mesmo documento (`view-menu` / `view-progresso`), alternadas por `trocarView`.
- O stepper de template edita só o número; o prefixo vem do servidor e vai de volta intacto.
- **Um stepper por grupo** (`agruparBases()` + mapa `GRUPOS`), não por base: as quatro amigáveis
  compartilham o número, o contencioso tem o dele. A linha mostra o total do grupo (detalhe por base
  no `title` do badge) e os prefixos distintos. `lerTemplates()` reexpande para uma entrada por base
  antes do `PUT`, repetindo o número do grupo e mandando o prefixo de cada uma.
- Antes de disparar: `PUT /api/templates` e um `confirm()` que diz quantos contatos **reais** vão sair
  e se vai agendar ou enviar agora.
- `EventSource` em `/api/executar`; o `onmessage` roteia por `tipo`: `passo` → trilha, `bases` →
  desenha as cinco linhas, `etapa` (`base`/`login`/`plano`) → estado por base, `log`/`erro` → log
  técnico, `fim` → encerra e recarrega o histórico.
- `agendado()` espelha o `decideMode` do `dispatch.js` (buffer de 2min) **apenas para avisar**; quem
  decide é o `dispatch.js`. Se o buffer mudar lá, mude aqui junto.
- Horário inicial: agora + 15 minutos. Período inicial: `/api/periodo-padrao`.
- Modo teste troca a faixa de aviso e recarrega as contagens da outra pasta.
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
