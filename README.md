# Base de disparo

Gera os CSVs usados nos disparos da Porto e dispara pelo dashboard. Todo
arquivo de saida tem duas colunas, `phonenumber` e `name`, e fica em `out/`.

O projeto tem duas metades:

- **geracao** (Python, na raiz) — le os bancos e escreve os cinco CSVs em `out/`;
- **disparo** (Node + Playwright, em `auto/`) — pega esses CSVs e cria lista,
  campanha e transmissao no dashboard;
- **tela** (`app/`) — junta as duas num fluxo de quatro passos no browser.

## Instalacao

```bash
pip install -r requirements-dev.txt   # requirements.txt + pytest
cp .env.example .env   # e preencha as senhas

cd auto && npm install && npx playwright install chromium
```

## Testes

```bash
python -m pytest -q   # regras de contatos.py e gerar_base.py
cd auto && npm test   # regras de auto/lib/dispatch-logic.js
```

## Tela (caminho normal)

```bash
python -m app.server
```

Abre em <http://127.0.0.1:8000>. Sao duas telas:

**Menu.** Escolhe o numero do template de dois grupos — Amigavel (as quatro
bases amigaveis usam sempre o mesmo numero) e Contencioso (tem o proprio) —,
escolhe o horario e clica em Disparar. O prefixo fica fixo, so o numero muda de
rodada pra rodada. Uma faixa no topo confere a VPN assim que a tela abre, com
ate 3 tentativas.

**Progresso.** Depois do clique a tela vira acompanhamento: VPN, geracao da
base e disparo, com as cinco bases mostrando em qual etapa cada uma esta
(criando lista, criando campanha, criando transmissao) e o que deu certo ou
errado no fim. O log tecnico completo fica recolhido embaixo.

O horario vale para tudo: entra no `copy.md`, no nome das campanhas e na hora
do agendamento. Acima de ~2min de folga a transmissao e agendada; abaixo disso
a plataforma envia na hora — a tela avisa qual dos dois vai acontecer.

O **modo teste** troca a origem dos CSVs de `out/` para `auto/bases/`, que tem
um contato so por base — serve pra exercitar a automacao do dashboard sem
mandar mensagem pra cliente.

Em **Opcoes avancadas** da pra pular a geracao da base (reaproveitando os CSVs
que ja estao em `out/`), desligar o relatorio Excel e mudar o periodo.

## Gerar a base direto do banco (linha de comando)

```bash
python gerar_base.py
```

Por padrao le de ontem ate hoje; na segunda-feira volta ate a sexta anterior.
Para outro periodo:

```bash
python gerar_base.py --data-inicio 2026-08-01 --data-fim 2026-08-10
```

Outras opcoes:

| Opcao | Efeito |
| --- | --- |
| `--hora 17H` | Hora usada no `copy.md` (padrao: hora atual) |
| `--sem-relatorio` | Nao gera o Excel de conferencia em `relatorio/` |
| `--sem-copy` | Nao reescreve o `copy.md` |

## Gerar a partir de um Excel pronto (caminho manual)

Coloque a planilha com as abas `TempA`/`TempB` em `in/` e rode:

```bash
python extract.py
```

Os Excels de `in/` sao apagados ao final; use `--manter-excel` para preservar.

## Saida

| Arquivo | Conteudo |
| --- | --- |
| `out/amigavel_ABW.csv` | Amigavel com rating A, B ou W |
| `out/amigavel_C.csv` | Amigavel com rating C |
| `out/amigavel_DEZ.csv` | Amigavel com rating D, E ou Z |
| `out/amigavel_na_rating.csv` | Amigavel sem rating (ou rating desconhecido) |
| `out/contencioso.csv` | Contencioso, independente de rating |
| `copy.md` | Nome de cada campanha, com data e hora |
| `relatorio/Base_interacoes_porto_AAAAMMDD.xlsx` | Conferencia: Base, Interagiram, Novos, Disparo |

O grupo sai da primeira letra do rating (`Z_REDUCAO` entra em D/E/Z,
`W_FPD_COM_PL` entra em A/B/W). Rating desconhecido nao interrompe a geracao:
vai para o CSV sem rating e aparece como aviso no final da execucao.

## Regras de elegibilidade

Entra no disparo quem:

- nao escolheu opcao de pagamento na conversa (`tag_opcao_pagamento` vazia);
- nao respondeu ao ultimo disparo (`houve_interacao = NAO`);
- nao esta em `pre-cobranca` nem `Acima de 97` dias;
- nao tem `ind_baixa` igual a `C` (acordo) ou `Q` (quitado);
- tem cadastro localizado, com `tipo` amigavel ou contencioso.

Somam-se os clientes novos do periodo que ainda nao estao nessa base. No fim,
telefones repetidos sao removidos globalmente: um numero recebe um disparo so.
Telefone com menos de 10 digitos e descartado, porque nao e discavel.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `gerar_base.py` | Pipeline banco -> CSV |
| `extract.py` | Pipeline Excel -> CSV |
| `contatos.py` | Normalizacao, rating, deduplicacao e escrita dos CSVs |
| `banco.py` | Engines e consultas |
| `config.py` | Caminhos e leitura do `.env` |
| `sql/` | Queries |
| `app/server.py` | Servidor da tela (FastAPI); `/api/executar` transmite o progresso por SSE |
| `app/passos.py` | VPN, geracao, templates e disparo, um passo por funcao |
| `app/static/` | A tela: HTML, CSS e JS sem build |
| `auto/` | Automacao Playwright do dashboard (veja `auto/CLAUDE.md`) |

## Disparo pela linha de comando

```bash
cd auto
node dispatch.js --hora 14:30                    # le de ../out
node dispatch.js --hora 14:30 --bases-dir bases  # bases de teste
```

Sem `--hora`, o script pergunta o horario no terminal.
