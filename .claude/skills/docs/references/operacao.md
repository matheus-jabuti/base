# Operação

## Instalação

```bash
pip install -r requirements-dev.txt   # requirements.txt + pytest
cp .env.example .env          # preencher DB_*, CUSTOMERS_DB_*, OWNER_ID

cd auto && npm install && npx playwright install chromium

# opcional: abrir a tela como http://disparo.porto (uma vez, pede admin)
powershell -ExecutionPolicy Bypass -File tools\registrar-host.ps1
```

`registrar-host.ps1` só adiciona `127.0.0.1 disparo.porto` ao arquivo hosts do Windows. O servidor
(`app/server.py:_escolher_porta`) usa a porta 80 quando está livre (aí o endereço não tem porta),
senão a 8000; `PORT` no `.env`/ambiente fixa o valor.

Dependências Python fixadas em `requirements.txt` (pandas, SQLAlchemy, psycopg2, openpyxl, fastapi,
uvicorn); `requirements-dev.txt` soma o `pytest`. O Playwright é `devDependency` de `auto/` — o
download do Chromium é passo separado.

**Os dois bancos só respondem com a VPN da empresa ligada.** É a causa número um de falha.

## Comandos

```bash
python -m app.server                      # tela em http://disparo.porto (ou http://127.0.0.1:<PORT>, default 80/8000)

python gerar_base.py                      # banco -> out/*.csv
python gerar_base.py --data-inicio 2026-08-01 --data-fim 2026-08-10
python gerar_base.py --sem-relatorio
python extract.py [--manter-excel]        # caminho manual: in/*.xlsx -> out/*.csv

python gerar_base_b.py                    # Operação B: banco -> out_b/*.csv
python gerar_base_b.py --previa           # só as contagens, sem gravar

python -m pytest -q                       # suíte Python (contatos.py, contatos_b.py, gerar_base.py)
cd auto && npm test                       # suíte Node (dispatch-logic.js)
cd auto && node dispatch.js --hora 14:30                        # lê de ../out (PRODUÇÃO)
cd auto && node dispatch.js --hora 14:30 --bases-dir bases      # bases de teste
cd auto && node dispatch.js --hora 14:30 --fases campanha,lista # só cria campanha e lista
cd auto && node dispatch.js --operacao b --hora 14:30                     # Operação B, lê de ../out_b (PRODUÇÃO)
cd auto && node dispatch.js --operacao b --hora 14:30 --bases-dir bases-b # Operação B, bases de teste
```

Sem `--hora`, o `dispatch.js` pergunta no terminal. Sem `--data-*`, o `gerar_base.py` usa ontem→hoje
(na segunda-feira, sexta→hoje). `--fases` (vírgula, subconjunto de `campanha`/`lista`/`transmissao`,
qualquer ordem na linha de comando; rodam sempre nessa ordem) escolhe o que criar; padrão as três.
Uma fase de fora não roda.

## Modo teste

Troca a origem dos CSVs de `out/` para `auto/bases/` (ou de `out_b/` para `auto/bases-b/`, na
Operação B), que tem **um contato por base**. Serve para
exercitar a automação do dashboard inteira — login, campanha, lista, transmissão — sem mandar mensagem
para cliente real. Use sempre que estiver mexendo em `auto/`.

Mesmo em teste, lista, campanha e transmissão **são criadas de verdade** no dashboard, com descrição
`by automação` (`by automação · Operação B` na Operação B). Não existe dry-run.

## Rodada normal pela tela

1. VPN ligada (o chip no rodapé da barra lateral confere sozinho ao abrir).
2. `python -m app.server`, abrir o endereço que ele imprime (`http://disparo.porto` se `registrar-host.ps1`
   já rodou, senão `http://127.0.0.1:<porta>`) — abre na rota **Preparar**.
3. Se precisar, ajustar o número do template na rota **Templates** (um por grupo: amigável A/B/W+C+N/A
   Rating juntas, D/E/Z e contencioso à parte) e **Salvar templates**.
4. Escolher o horário no relógio (começa em agora +15min) — o disparo é sempre agendado; a tela avisa quando
   o horário já passou ou está perto demais (aí é agendado 10min pra frente).
5. Conferir a faixa de modo (produção × teste) e clicar em **Revisar e disparar**: o painel mostra
   bases, templates, horário resolvido e a checagem de VPN, período, filtro e bases vazias. Em
   produção, o disparo exige segurar o botão por 1,5s.
6. A rota **Monitorar** assume: VPN → base → disparo, com as cinco bases mostrando a etapa atual
   (campanha/lista/transmissão), métricas da geração e tempo por fase na lateral.
7. Terminou: a mesma rota vira o resultado — frase de fechamento, tabela por base e arquivos gerados.
   O log técnico fica recolhido embaixo (abre sozinho em caso de erro) e a rota **Histórico** já mostra
   as linhas novas.

No cartão "Geração da base" dá para pular a geração (reaproveitando os CSVs já em `out/`), desligar o
Excel de conferência, mudar o período e ver o filtro manual. **Pré-visualizar sem gravar** roda a
geração inteira sem escrever CSV nem abrir o dashboard.

## Onde olhar quando falha

| Sintoma | Onde |
| --- | --- |
| Falha por base, no dashboard | `auto/scripts/out/erro-<key>-<timestamp>.png` (screenshot da tela real) |
| Histórico de execuções | `auto/logs/disparos.csv` (também na rota Histórico, com busca e filtros) |
| Conferência da base gerada | `relatorio/Base_interacoes_porto_AAAAMMDD.xlsx`, abas Base/Interagiram/Novos/Disparo |

## Problemas conhecidos

**"Conecte a VPN da empresa e tente de novo."** — socket não fechou em 4s. VPN caída, ou `DB_HOST`
vazio no `.env`.

**"Node nao encontrado no PATH."** — a tela procura `node` com `shutil.which`. Instale ou ajuste o PATH
do processo que roda o servidor.

**"Ja tem uma execucao em andamento."** — o lock global do `server.py`. Espere terminar; se travou,
reinicie o servidor.

**"CSV nao encontrado: ..."** — falta um dos cinco arquivos na pasta do modo escolhido. Em produção,
rode a geração antes; em teste, o arquivo tem que existir em `auto/bases/`.

**Base aparece como `pulado`** — CSV com zero contatos. Não é erro: o dashboard rejeitaria o upload.

**"Lista/Campanha/Template não ficaram selecionáveis após 6 tentativas"** — ou o backend está lento
indexando o CSV (raro passar de 6 × 10s), ou o **template não existe** com aquele número. Confira o
número no dashboard: a falha acontece tarde, depois que lista e campanha já foram criadas — e elas
ficam lá, criadas.

**Login falhando** — `scripts/out/auth.json` inválido é detectado e refeito sozinho. Persistindo,
apague o arquivo e verifique `JABUTI_EMAIL`/`JABUTI_PASSWORD`. Não há SSO Microsoft.

**Editei um `.sql` e nada mudou** — `banco.ler_sql` tem `lru_cache`. Reinicie o processo.

**"Nenhum contato elegivel no periodo."** — a geração rodou e filtrou tudo. Confira o período e o
`OWNER_ID`; o Excel de conferência mostra em qual etapa a base esvaziou.

## Repetir uma rodada

Não existe checagem de nome duplicado. Como o nome embute data **e** horário, repetir no mesmo dia com
horário diferente não colide. Repetir com o **mesmo** horário faz a criação da lista falhar no toast de
sucesso, e a base vai para o log como `erro` — sem criar campanha nem transmissão.

Também não há como reaproveitar uma lista de distribuição existente: toda execução cria uma nova.
Decisão registrada em `auto/CLAUDE.md` → "Known gaps".
