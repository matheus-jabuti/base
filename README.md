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

Abre em <http://127.0.0.1> (porta 80 se estiver livre, senao 8000 — o servidor
avisa o endereco ao subir). Pra abrir como **`http://disparo.porto`**, rode uma
vez `powershell -ExecutionPolicy Bypass -File tools\registrar-host.ps1` (pede
administrador — so adiciona `disparo.porto` ao arquivo hosts). Fixar a porta:
`PORT` no `.env` ou no ambiente.

As rotas ficam numa **barra lateral** a esquerda, em tres grupos: **Operacao**
(Preparar, Templates, Agenda), **Operacao B** (Preparar B, Templates B) e
**Acompanhamento** (Monitorar, Historico). Cada uma tem endereco proprio
(`#preparar`, `#templates`, `#preparar-b`, ...). O modo (producao/teste),
o estado da VPN e o tema ficam ancorados no rodape da barra lateral, visiveis em
qualquer rota.

**Preparar.** Em ordem: o card **Quando** (relogio, comeca em agora +15min); o card
**O que criar no dashboard** (campanha, lista de distribuicao e transmissao — nessa
ordem, as tres marcadas por padrao; desmarque as que nao quer criar nesta rodada);
**Bases desta rodada** (uma linha por base so leitura, volume de contatos em barra
e o template resolvido); **Templates deste disparo** (nome final por grupo e atalho
pra rota Templates); e, recolhido em **Periodo e geracao
(padrao)**, pular a geracao reaproveitando os CSVs de `out/`, desligar o relatorio
Excel, mudar o periodo e ver os telefones do filtro manual em `filtros/`. A coluna
da direita resume o que vai sair — total de contatos, modo, horario, o que vai
criar, templates, periodo, filtro, ultima execucao.

**Templates.** Um cartao por segmento — Amigavel (A/B/W, C e N/A Rating usam
sempre o mesmo numero), Amigavel D/E/Z (numero proprio) e Contencioso (tem o
proprio, ate 10; os amigaveis ate 7). O prefixo de cada base fica fixo, so o
numero muda de rodada pra rodada, e o nome final (`WPP_contencioso_07`) aparece ao
vivo. **Salvar templates** grava o numero em `auto/config/template-numeros.json`
(fora do git — nao suja o `git status`) e no `localStorage` do navegador; vale pro
disparo manual e pra Agenda.

Marcar so `campanha` e `lista` (sem `transmissao`) e util pra deixar tudo montado
e disparar a transmissao depois. Marcar `transmissao` sem `campanha`/`lista` so
funciona se elas ja tiverem sido criadas antes no dashboard — o painel de revisao
avisa.
Em modo teste o relatorio Excel nunca e escrito (o check fica desabilitado) —
ensaio nao deixa arquivo em `relatorio/`.

**Revisao.** O botao **Revisar e disparar** nao dispara: abre um painel com a
lista de bases e templates, o horario (todo disparo e agendado, nunca enviado na
hora — sempre sobra janela pra cancelar no dashboard; se o horario ja passou ou
esta perto demais, e agendado 10min pra frente) e uma checagem do que da pra
checar antes (VPN, periodo, filtro manual, bases vazias).
Em producao o disparo exige **segurar o botao por 1,5s**; em teste e na
pre-visualizacao e um clique so.

**Agenda.** A lista de disparos automaticos: uma linha por data + hora, com o
numero de template de cada grupo (amigavel, amigavel D/E/Z e contencioso, igual a rota Templates).
Enquanto `python -m app.server` estiver rodando nesta maquina (com a VPN ligada),
o servidor dispara sozinho em cada horario. Preencha data, hora e os templates,
clique em **Adicionar horario**, depois **Salvar agenda** (os campos de template
ja vem preenchidos com o valor atual, so ajuste).

O **modo dos disparos automaticos** fica na coluna da direita e comeca sempre em
**Teste** (dispara as bases de 1 contato de `auto/bases/`, nao chega a cliente).
So em **Producao** (troca com confirmacao, aviso vermelho enquanto estiver nele)
e que roda a pipeline inteira — gera a base do periodo, aplica os templates da
linha e envia as cinco bases pros clientes reais. Esse modo e independente do
toggle Producao/Teste do topo, que vale so pro disparo manual.

Cada linha mostra a situacao: `agendado`, `disparado`,
`falhou`, `perdido` (servidor estava fora do ar ou ocupado por mais de 20min
depois da hora) ou `desativado`. Item que falhou ou se perdeu tem um botao
**re-armar** pra ele tentar de novo (se ainda estiver dentro dos 20min). A coluna
da direita mostra o proximo disparo e se o agendador esta ligado.

O disparo automatico comeca na hora exata do item; como todo disparo e agendado
na plataforma (nunca enviado na hora), a transmissao fica agendada ~10min pra
frente. Ele **nao aparece na rota Monitorar** — o resultado fica no Historico. Um
atraso de ~10 a 30min entre o horario do item e a mensagem chegar e esperado (a
pipeline leva alguns minutos, mais os 10min do agendamento e a fila da
plataforma).

## Operacao B

Uma segunda operacao de disparo, separada da normal (chamada de Operacao A no
codigo) em tudo: fonte de dados propria, pasta de saida propria (`out_b/`),
cinco planilhas proprias, templates proprios e rota propria na tela. Uma nao
mexe na outra — trocar template, gerar base ou disparar de um lado nao altera
nada do outro.

A fonte de dados e uma planilha xlsx solta em `in_b/` (nome do arquivo pode
mudar a cada rodada), com as colunas `phone_number`, `nome` e `prioridade` —
por enquanto nao vem mais do banco.

A diferenca de regra esta na classificacao: o contencioso, que na Operacao A e
uma categoria so, aqui e separado por valor.

| Planilha (`out_b/`) | Rating (`prioridade`) |
| --- | --- |
| `b_amigavel_A.csv` | `A` |
| `b_amigavel_D.csv` | `D` |
| `b_contencioso_menor_500.csv` | `MENOR_500` |
| `b_contencioso_maior_500.csv` | `MAIOR_500` |
| `b_outros.csv` | `Outros`, vazio ou qualquer valor fora da lista |

O rating aqui e comparado pelo **valor inteiro**, nao pela primeira letra como
na Operacao A (`MENOR_500` e `MAIOR_500` comecam igual). Rating fora dos cinco
esperados nao interrompe a geracao: cai em `b_outros.csv` e aparece como aviso
no fim da execucao.

O nome sai capitalizado (`MARIA DAS DORES` -> `Maria Das Dores`). No cadastro da
operacao B ele vem preenchido em todos os registros e e so o primeiro nome
(`Nivaldo`, `Fernanda`). Quem nao tiver nome **entra no disparo mesmo assim**,
com o nome `Cliente` — ao contrario da Operacao A, que descarta o registro sem
nome.

Nao ha periodo: a planilha ja e a base fechada da rodada. Tambem nao ha
relatorio Excel nem agenda automatica — o agendamento acontece no dashboard,
como no disparo normal.

**Deduplicacao em duas camadas** (mantem sempre um so):

- **telefone repetido** — o mesmo numero recebe um disparo so;
- **CPF repetido** — a mesma pessoa (mesmo CPF) com varios numeros no cadastro
  recebe um disparo so. Fica o numero do cadastro mais recente. A planilha de
  `in_b/` nao traz CPF, entao essa camada fica inerte (sempre 0) por enquanto —
  o codigo continua pronto pra ela caso a coluna volte a existir na fonte.

O resumo da geracao mostra quantos cairam em cada camada (ex.: `Deduplicacao: 0
por telefone repetido, 426 por CPF repetido`).

O filtro manual de `filtros/` vale para as duas operacoes, sem separacao.

**Como reconhecer no dashboard.** Campanha, lista e transmissao criadas pela Operacao B saem
marcadas nos dois campos visiveis:

- nome: `Op. B <planilha> - DD/MM/AAAA - HHHMM` (ex.: `Op. B Contencioso Menor 500 -
  10/09/2026 - 14H30`) — ordenando a listagem por nome, os cinco ficam juntos; nomes ficam ate 50
  caracteres no total (limite do campo no dashboard); o `campaignAlias` da API rejeita
  `\ < > " % : &`, entao nunca usar `<500`/`>500` (foi a causa de um erro 422 em producao) —
  "Menor 500"/"Maior 500" por extenso, com prefixo `Op. B` (em vez de `Operacao B`) pra caber;
- descricao: `by automação · Operação B`, em vez do `by automação` da operacao normal.

Renomear um item na mao nao apaga a marca: a descricao continua dizendo de qual operacao ele veio.

**Preparar B.** Mesmos cards da rota Preparar (Quando, O que criar, as cinco
planilhas, templates da rodada), sem periodo e sem relatorio Excel. O botao
**Revisar e disparar** abre o mesmo painel de revisao e o andamento vai pra rota
**Monitorar**, marcado como Operacao B.

**Templates B.** Um cartao por planilha — cada rating tem numero de template
proprio, pra mensagem poder variar entre os cinco. **Salvar templates** grava em
`auto/config/template-numeros-b.json` (fora do git) e no `localStorage`, sem
tocar nos numeros da Operacao A.

Pela linha de comando:

```bash
python gerar_base_b.py            # banco -> out_b/*.csv
python gerar_base_b.py --previa   # so as contagens, sem gravar

cd auto
node dispatch.js --operacao b --hora 14:30                        # le de ../out_b
node dispatch.js --operacao b --hora 14:30 --bases-dir bases-b    # bases de teste
```

**Monitorar.** Acompanhamento ao vivo: VPN, geracao da base e disparo, com as
cinco bases mostrando em qual etapa cada uma esta (campanha, lista,
transmissao). A coluna lateral mostra as metricas da geracao (conversas no
periodo, elegiveis, filtro removido etc.) e o tempo de cada fase. Um botao
**Cancelar execucao** interrompe uma rodada em andamento (o disparo para na
hora; a geracao da base para no proximo ponto de checagem, nao
instantaneamente). Ao terminar, a mesma rota vira o resultado: o que foi
agendado ou enviado, tabela por base com contatos, tempo e status, e os
arquivos gerados (CSV de removidos pelo filtro, relatorio, log tecnico).

O botao **Pre-visualizar sem gravar** roda a geracao da base ate o fim —
incluindo o filtro manual — sem gravar nenhum CSV nem disparar nada, so pra ver
quantos contatos sairiam em cada base antes de confirmar de verdade.

**Historico.** Uma linha por base disparada, direto de `auto/logs/disparos.csv`,
com busca por base, filtro por status (ok/erro/pulado), por tipo de envio
(agendado — `imediato` so aparece em linhas antigas) e por quantidade. O motivo
do erro aparece na propria tabela.

O horario vale para tudo: entra no nome das campanhas e na hora do agendamento.
A transmissao e sempre agendada na plataforma (nunca enviada na hora), pra
sempre haver janela de cancelamento; se o horario ja passou ou esta a menos de
10min, e agendada 10min pra frente — a tela avisa quando isso vai acontecer.

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
| `gerar_base_b.py` | Pipeline da Operacao B: planilha de `in_b/` -> `out_b/` |
| `contatos_b.py` | Classificacao por rating e escrita dos CSVs da Operacao B |
| `banco.py` | Engines e consultas |
| `config.py` | Caminhos e leitura do `.env` |
| `sql/` | Queries |
| `app/server.py` | Servidor da tela (FastAPI); `/api/executar` transmite o progresso por SSE |
| `app/passos.py` | VPN, geracao, templates e disparo, um passo por funcao |
| `app/operacao_b.py` | Os mesmos passos, para a Operacao B (`/api/b/...`) |
| `app/agendador.py` | Thread que dispara sozinha nos horarios de `auto/config/agenda.json` |
| `app/static/` | A tela: HTML, CSS e JS sem build (`operacao-b.js` = rota da Operacao B) |
| `auto/config/agenda.json` | Horarios dos disparos automaticos (`[{data, hora, ativo}]`) |
| `auto/config/dispatches.json` | Estrutura das 5 bases (sem o numero do template) |
| `auto/config/dispatches-b.json` | O mesmo, para as 5 planilhas da Operacao B |
| `auto/config/template-numeros.json` | Numero do template por grupo — fora do git, semeado do `.example` |
| `auto/config/template-numeros-b.json` | O mesmo, para a Operacao B |
| `auto/` | Automacao Playwright do dashboard (veja `auto/CLAUDE.md`) |

## Disparo pela linha de comando

```bash
cd auto
node dispatch.js --hora 14:30                        # le de ../out
node dispatch.js --hora 14:30 --bases-dir bases      # bases de teste
node dispatch.js --hora 14:30 --fases campanha,lista # so campanha e lista
```

Sem `--hora`, o script pergunta o horario no terminal.

| Opcao | Efeito |
| --- | --- |
| `--operacao a\|b` | Qual operacao disparar (padrao `a`). Define config, templates e pasta de bases |
| `--bases-dir <pasta>` | De onde ler os CSVs (padrao `../out`, ou `../out_b` com `--operacao b`; `bases`/`bases-b` para o modo teste) |
| `--fases <lista>` | Quais fases criar, separadas por virgula: `campanha`, `lista`, `transmissao` (nessa ordem de execucao). Padrao: as tres. A ordem que voce passa nao importa |
