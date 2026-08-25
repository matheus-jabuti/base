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

Abre em <http://127.0.0.1:8000>. Sao tres abas fixas no topo — **Preparar**,
**Monitorar** e **Historico** —, cada uma com endereco proprio (`#preparar`,
`#monitorar`, `#historico`). O modo (producao/teste) e o estado da VPN ficam
sempre visiveis na barra do topo, em qualquer aba.

**Preparar.** Uma linha por base, com o volume de contatos em barra, e o numero
do template por grupo — Amigavel (as quatro bases amigaveis usam sempre o mesmo
numero) e Contencioso (tem o proprio). O prefixo fica fixo, so o numero muda de
rodada pra rodada. Abaixo, o horario (com atalhos: agora, +15min, +30min,
+60min) e as opcoes de geracao: pular a geracao reaproveitando os CSVs que ja
estao em `out/`, desligar o relatorio Excel, mudar o periodo e ver os arquivos e
telefones do filtro manual em `filtros/`. A coluna da direita resume o que vai
sair — total de contatos, modo, horario, templates, filtro, ultima execucao.

**Revisao.** O botao **Revisar e disparar** nao dispara: abre um painel com a
lista de bases e templates, o horario resolvido (agendado ou imediato) e uma
checagem do que da pra checar antes (VPN, periodo, filtro manual, bases vazias).
Em producao o disparo exige **segurar o botao por 1,5s**; em teste e na
pre-visualizacao e um clique so.

**Monitorar.** Acompanhamento ao vivo: VPN, geracao da base e disparo, com as
cinco bases mostrando em qual etapa cada uma esta (lista, campanha,
transmissao). A coluna lateral mostra as metricas da geracao (conversas no
periodo, elegiveis, filtro removido etc.) e o tempo de cada fase. Um botao
**Cancelar execucao** interrompe uma rodada em andamento (o disparo para na
hora; a geracao da base para no proximo ponto de checagem, nao
instantaneamente). Ao terminar, a mesma aba vira o resultado: o que foi
agendado ou enviado, tabela por base com contatos, tempo e status, e os
arquivos gerados (CSV de removidos pelo filtro, relatorio, log tecnico).

O botao **Pre-visualizar sem gravar** roda a geracao da base ate o fim —
incluindo o filtro manual — sem gravar nenhum CSV nem disparar nada, so pra ver
quantos contatos sairiam em cada base antes de confirmar de verdade.

**Historico.** Uma linha por base disparada, direto de `auto/logs/disparos.csv`,
com busca por base, filtro por status (ok/erro/pulado), por tipo de envio
(agendado/imediato) e por quantidade. O motivo do erro aparece na propria
tabela.

O horario vale para tudo: entra no nome das campanhas e na hora do agendamento.
Acima de ~2min de folga a transmissao e agendada; abaixo disso a plataforma
envia na hora — a tela avisa qual dos dois vai acontecer.

O **modo teste** troca a origem dos CSVs de `out/` para `auto/bases/`, que tem
um contato so por base — serve pra exercitar a automacao do dashboard sem
mandar mensagem pra cliente.

A tela segue o tema do sistema (claro ou escuro); o botao no canto direito da
barra alterna entre claro, escuro e o padrao do sistema.

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
| `--sem-relatorio` | Nao gera o Excel de conferencia em `relatorio/` |

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
| `relatorio/Base_interacoes_porto_AAAAMMDD.xlsx` | Conferencia: Base, Interagiram, Novos, Disparo, cpc (se houver) |

O grupo sai da primeira letra do rating (`Z_REDUCAO` entra em D/E/Z,
`W_FPD_COM_PL` entra em A/B/W). Rating desconhecido nao interrompe a geracao:
vai para o CSV sem rating e aparece como aviso no final da execucao.

## Filtro manual

Pra remover na hora algum numero que nao pode entrar no disparo (pedido de opt-out, numero errado
etc.), solte uma planilha (`.xlsx` ou `.csv`) com os telefones em `filtros/`. Nao precisa cabecalho
nem coluna fixa — qualquer celula que pareca telefone valido entra no filtro.

A cada geracao (banco ou Excel), antes de escrever os CSVs, o pipeline le tudo que estiver em
`filtros/` e remove esses telefones das bases. Roda sempre, sem opcao de desligar; se a pasta esta
vazia, nao faz nada. Os arquivos **nao sao apagados** depois de usados — ficam valendo pras proximas
rodadas ate serem removidos manualmente.

Na tela, o card **Filtro manual** mostra os arquivos e a contagem de telefones antes de rodar. Depois
de uma geracao que removeu algo, o resultado traz um link pra baixar a lista dos numeros removidos
(tambem salva em `relatorio/filtro_removidos_AAAAMMDD.csv`).

## Regras de elegibilidade

Entra no disparo quem:

- nao escolheu opcao de pagamento na conversa (`tag_opcao_pagamento` vazia);
- nao respondeu ao ultimo disparo (`houve_interacao = NAO`);
- nao esta em `pre-cobranca` nem `Acima de 97` dias;
- nao tem `ind_baixa` igual a `C` (acordo) ou `Q` (quitado);
- nao confirmou opcao de pagamento nos ultimos 2 dias (`DIAS_BLOQUEIO_PAGAMENTO_RECENTE` em
  `gerar_base.py`) — evita cobrar de quem acabou de pagar e o pagamento ainda nao compensou;
- tem cadastro localizado, com `tipo` amigavel ou contencioso.

Somam-se os clientes novos do periodo que ainda nao estao nessa base. No fim,
telefones repetidos sao removidos globalmente: um numero recebe um disparo so.
Telefone com menos de 10 digitos e descartado, porque nao e discavel.

## Arquivos

| Arquivo | Papel |
| --- | --- |
| `gerar_base.py` | Pipeline banco -> CSV |
| `extract.py` | Pipeline Excel -> CSV |
| `contatos.py` | Normalizacao, rating, deduplicacao, filtro manual e escrita dos CSVs |
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
