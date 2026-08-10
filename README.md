# Base de disparo

Gera os CSVs usados nos disparos da Porto. Todo arquivo de saida tem duas
colunas, `phonenumber` e `name`, e fica em `out/`.

## Instalacao

```bash
pip install -r requirements.txt
cp .env.example .env   # e preencha as senhas
```

## Gerar a base direto do banco (caminho normal)

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
| `out/amigavel_sem_rating.csv` | Amigavel sem rating (ou rating desconhecido) |
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
