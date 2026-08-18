# Geração da base (Python)

Duas entradas, um núcleo comum, cinco CSVs de saída.

```
gerar_base.py (banco)  ─┐
                        ├─> coletar_contatos() ─> aplicar_filtro() ─> escrever_grupos() ─> out/*.csv
extract.py (Excel)     ─┘        (filtros/*)                       └─> escrever_copy()  ─> copy.md
```

## Configuração — `config.py`

- Caminhos fixos derivados de `BASE_DIR`: `sql/`, `in/`, `out/`, `relatorio/`, `filtros/`, `copy.md`, `.env`.
- `load_env()` lê o `.env` linha a linha com `os.environ.setdefault` — **variável já no ambiente
  vence o `.env`**. Aspas nas pontas do valor são removidas.
- `require_env(nome)` levanta erro explicando qual variável faltou; use sempre em vez de
  `os.environ[...]` cru.
- `owner_id()` cai no `DEFAULT_OWNER_ID` (Porto Seguro) quando `OWNER_ID` não está preenchido.

Blocos de variáveis esperados no `.env` (modelo em `.env.example`): `DB_*` (messagesdb),
`CUSTOMERS_DB_*` (b2bcustomers-db), `OWNER_ID`. `*_PORT` vazio vira `5432`.

## Acesso a dados — `banco.py` + `sql/`

- `build_engine(prefixo)` monta a URL com `URL.create` porque as senhas têm caractere especial —
  não concatene string de conexão à mão.
- `messages_engine()` = prefixo `DB`; `customers_engine()` = prefixo `CUSTOMERS_DB`.
- `ler_sql()` tem `lru_cache`: editar um `.sql` exige reiniciar o processo.
- As três consultas devolvem tudo como `str` (`dtype="str"`) e passam por `_strip_colunas`. Nenhuma
  conversão numérica acontece no Python — trate coluna como texto.

### `consulta_report.sql` (messagesdb)

Uma linha por `conversation_id` no período, filtrada por `ownerId`. Colunas que o pipeline usa:

- `telefone` — `metadata->>'phone_number'` com fallback para `phoneNumber`.
- `houve_interacao` — `SIM` quando alguma mensagem da conversa tem `totalTokens` preenchido, ou seja,
  houve resposta processada pelo agente. `NAO` caso contrário.
- `tag_opcao_pagamento` — primeira tag `tran_confirmar_opcao_pagamento%` da conversa.
- `ultima_tag_valida` / `ultimo_timestamp_valido` — última tag ignorando `start_agent_execution`
  (que só volta a valer quando não há nenhuma outra).

### `consulta_customer.sql` (b2bcustomers-db)

Cadastro dos telefones informados. Um cliente pode ser achado por qualquer um dos **sete** campos de
telefone; eles são deduplicados preservando a ordem original e viram `telefone`, `telefone_2`,
`telefone_3`.

Derivações que moram na query, não no Python:

- `tipo` — `cod_credor` em `('2','7')` → `amigavel`; **qualquer outro valor** → `contencioso`.
- `rating` — `campos->'cod_indicador'->>'RAT_AMIG'`.
- `dias_atraso` — `current_date - dat_venci`.
- `bucket` — faixa de dias, com nomes diferentes por tipo (`pre-cobranca`, `Bucket 01..03`,
  `Acima de 97` para amigável; `Cont. Abaixo de 100`, `100 a 180`, `180 a 360`, `360 a 540`,
  `Acima 540` para contencioso; `Fora da regra` como escape).

### `consulta_novos.sql`

Mesma extração de campos da anterior, mas filtrando por `updated_at` no período em vez de por lista
de telefones. São os clientes que entraram/mudaram e ainda não apareceram em conversa.

## Pipeline do banco — `gerar_base.py`

Ordem exata em `gerar()`:

1. `consultar_report` no período.
2. Descarta quem tem `tag_opcao_pagamento` preenchida — já escolheu forma de pagamento, não se cobra
   de novo.
3. Descarta telefone vazio.
4. `buscar_dados_customer` com os telefones restantes; `montar_lookup` indexa o cadastro por
   `telefone`, `telefone_2` e `telefone_3` (primeira ocorrência vence) para que o merge ache o
   cliente por qualquer um dos contatos.
5. `montar_base` faz o merge à esquerda e preenche o que não casou com `NAO LOCALIZADO`
   (`rating` vira string vazia).
6. `filtrar_elegiveis`: mantém `houve_interacao == "NAO"`, remove `bucket` em `BUCKETS_BLOQUEADOS`
   (comparação em minúsculas: `pre-cobrança`, `pre-cobranca`, `acima de 97`) e remove
   `ind_baixa` em `{"C","Q"}` (acordo e quitado).
6b. `consultar_pagamento_recente` + `remover_pagamento_recente`: tira dos elegíveis e dos novos quem
   confirmou opção de pagamento nos últimos `DIAS_BLOQUEIO_PAGAMENTO_RECENTE` dias (padrão 2),
   independente do período do relatório — ver seção "Bloqueio de pagamento recente" abaixo.
7. `consultar_novos` + `preparar_novos`: mesmo filtro de `ind_baixa`, telefone preenchido, e remove
   quem já está na base elegível.
8. `montar_disparo` concatena os dois e mantém só `tipo` em (`amigavel`, `contencioso`) — o que ficou
   `NAO LOCALIZADO` cai aqui.
9. `coletar_contatos` → `ler_telefones_filtro` + `aplicar_filtro` → `clear_output_folder` →
   `escrever_grupos` → `escrever_copy` → relatório.

**Nota:** o relatório Excel (`gravar_relatorio`) usa `df_disparo`, montado *antes* do filtro — as
abas `Base`/`Novos`/`Disparo` continuam mostrando os telefones filtrados como se fossem disparar.
A verdade sobre quem recebeu mensagem de verdade são os CSVs em `out/`, já pós-filtro.

Período padrão (`periodo_padrao`): ontem até hoje; **na segunda-feira volta três dias**, pegando a
sexta anterior. `main()` retorna `0` só se sobrou pelo menos um contato — base vazia é código `1`.

Relatório (`gravar_relatorio`, `relatorio/Base_interacoes_porto_AAAAMMDD.xlsx`): abas `Base`,
`Interagiram`, `Novos`, `Disparo`. Nunca sobrescreve — acrescenta `_2`, `_3` etc.

## Bloqueio de pagamento recente

Cobre um buraco real: `consulta_novos.sql` traz clientes pelo `updated_at` do cadastro
(`b2bcustomers-db`), sem nenhuma referência a conversa ou tag. Quando um cliente confirma opção de
pagamento, o cadastro dele costuma ser atualizado pelo processamento (boleto/PIX, mudança de valor ou
status) — e esse `updated_at` cai no período do próximo lote, fazendo o cliente reentrar como "novo" e
levar disparo de novo, mesmo tendo acabado de pagar. O filtro de `tag_opcao_pagamento` em
`consulta_report.sql`/`gerar()` (passo 2 acima) só protege quem veio pelo caminho de conversas — não
alcança esse caminho.

- `sql/consulta_pagamento_recente.sql` — telefones com tag `tran_confirmar_opcao_pagamento%`
  (`message_logs`, messagesdb) entre duas datas, **independente do período do relatório**.
- `banco.consultar_pagamento_recente` — chamada com `data_fim - DIAS_BLOQUEIO_PAGAMENTO_RECENTE` até
  `data_fim`, não `data_inicio`/`data_fim` do lote. Cobre tanto quem pagou dentro do período (reforço,
  já coberto pelo passo 2) quanto quem pagou pouco antes do `data_inicio` (não coberto por nada até
  então).
- `gerar_base.remover_pagamento_recente(df, telefones_bloqueados)` — função pura, aplicada nos dois
  lados: `df_elegiveis` (depois de `filtrar_elegiveis`) e `df_novos` (depois de `preparar_novos`).
- `DIAS_BLOQUEIO_PAGAMENTO_RECENTE = 2` em `gerar_base.py`. Mudar o prazo é só trocar essa constante.

## Regras de contato — `contatos.py`

É aqui que mora tudo que vale para os dois pipelines.

- **Telefone**: só dígitos; menos de `MIN_PHONE_DIGITS` (10 = DDD + 8) é descartado como não discável.
- **Nome**: espaços colapsados e `Title Case`. Sem nome, a linha é descartada.
- **Dedup global por telefone**: o mesmo número não recebe dois disparos, mesmo aparecendo em grupos
  diferentes. Vence a primeira ocorrência.
- **Grupo** (`resolve_group`): contencioso ignora rating e vai inteiro para `contencioso.csv`;
  amigável usa a **primeira letra** do rating (`RATING_GROUPS`), o que faz `Z_REDUCAO` cair em D/E/Z e
  `W_FPD_COM_PL` em A/B/W. Rating vazio ou com letra desconhecida vai para o grupo `sem_rating`.
- **Rating desconhecido não interrompe**: é contado em `ratings_desconhecidos` e sai como `AVISO:` no
  resumo. Se um rating novo aparecer com frequência, o ajuste é adicionar a letra em `RATING_GROUPS`.
- `clear_output_folder` esvazia `out/` a cada execução, preservando `.gitkeep`.
- `escrever_grupos` grava **todos** os CSVs, inclusive os vazios (só o cabeçalho) — o `dispatch.js`
  exige que os cinco arquivos existam.
- `escrever_copy` lista apenas os grupos não vazios, no formato
  `<CAMPAIGN_LABELS[grupo]> - DD/MM/AAAA - <hora>`.

Mapa de grupo → arquivo → rótulo de campanha está em `OUTPUT_FILES` e `CAMPAIGN_LABELS`; a
correspondência com `auto/config/dispatches.json` é contrato (ver `contratos.md`).

## Filtro manual — `filtros/`

Remove da base, depois de gerada, qualquer telefone que a operação precise excluir na hora (pedido de
opt-out, número errado, etc.). Roda **sempre**, nos dois pipelines (banco e Excel), sem flag pra
desligar — se `filtros/` está vazia, é um no-op.

- Solte um ou mais arquivos `.xlsx`/`.xlsm`/`.csv` em `filtros/`. Sem formato fixo: não precisa de
  cabeçalho nem coluna específica — `ler_telefones_filtro` varre toda célula de toda aba/linha e
  aceita qualquer valor que `normalize_phone` reconheça como telefone válido (≥10 dígitos). Texto,
  célula vazia ou número curto é ignorado silenciosamente.
- `aplicar_filtro(grupos, telefones)` roda logo após `coletar_contatos()`, antes de qualquer CSV ser
  escrito — remove por telefone em todos os grupos de uma vez (dedup já é global, então um telefone
  nunca aparece em mais de um grupo).
- Contagem de removidos vai pro stdout (`Filtro: N contato(s) removido(s)...`), que tanto o terminal
  quanto a tela (`app/passos.py`, via captura de stdout) já mostram sem mudança nenhuma nesses dois
  lugares.
- Arquivos ficam em `filtros/` entre execuções — **não é descartável feito `in/`**. Um arquivo de
  filtro esquecido ali continua sendo aplicado nas rodadas seguintes; é assim de propósito (evita ter
  que reenviar a planilha toda vez), mas vale conferir a pasta se um número sumir sem explicação.

## Pipeline do Excel — `extract.py`

Caminho manual, para quando a planilha chega pronta.

- Lê `in/*.xlsx|xlsm|xltx|xltm`, abas `TempA` e `TempB` (comparação em minúsculas).
- Cabeçalho na **linha 2**, dados a partir da **linha 3**.
- A aba tem vários blocos lado a lado: cada coluna `telefone` inicia um bloco, e as colunas `nome`,
  `tipo` e `rating` seguintes (antes do próximo `telefone`) pertencem a ele. Bloco incompleto levanta
  erro nomeando o que faltou.
- As duas abas são unificadas e deduplicadas juntas.
- Os Excels de `in/` são apagados ao final, a menos que `--manter-excel`.

## Ao mexer aqui

- Mudou regra de elegibilidade, bucket ou período: atualize este arquivo **e** a seção
  "Regras de elegibilidade" do `README.md`.
- Mudou nome ou conjunto de CSVs: veja o checklist em `contratos.md` — são quatro lugares.
- `gerar_base.py` precisa continuar imprimindo em `stdout` e expondo `gerar()` com essa assinatura:
  a tela depende disso (ver `app.md`).
