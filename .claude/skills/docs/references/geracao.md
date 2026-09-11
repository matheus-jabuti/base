# Geração da base (Python)

Duas entradas, um núcleo comum, cinco CSVs de saída.

```
gerar_base.py (banco)  ─┐
                        ├─> coletar_contatos() ─> aplicar_filtro() ─> escrever_grupos() ─> out/*.csv
extract.py (Excel)     ─┘        (filtros/*)
```

## Configuração — `config.py`

- Caminhos fixos derivados de `BASE_DIR`: `sql/`, `in/`, `out/`, `out_b/` (Operação B), `relatorio/`,
  `filtros/`, `.env`.
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
- As consultas devolvem tudo como `str` (`dtype="str"`) e passam por `_strip_colunas`. Nenhuma
  conversão numérica acontece no Python — trate coluna como texto.
- `consultar_operacao_b()` é a única sem parâmetro de período (ver "Operação B" abaixo).

### `consulta_report.sql` (messagesdb)

Uma linha por `conversation_id` no período, filtrada por `ownerId`. Colunas que o pipeline usa:

- `telefone` — `metadata->>'phone_number'` com fallback para `phoneNumber`.
- `houve_interacao` — `SIM` quando alguma mensagem da conversa tem `totalTokens` preenchido, ou seja,
  houve resposta processada pelo agente. `NAO` caso contrário.
- `tag_opcao_pagamento` — primeira tag `tran_confirmar_opcao_pagamento%` da conversa.
- `ultima_tag_valida` / `ultimo_timestamp_valido` — última tag ignorando `start_agent_execution`
  (que só volta a valer quando não há nenhuma outra).
- `tag_consulta_cliente_processa_dados` — presença da tag `int_consulta_cliente_processa_dados`
  (disparada em `ConsultaCliente.py`/`ConsultaClienteV2.py` do repo de tools quando o CPF valida e a
  API da Porto retorna dados do cliente). Só alimenta a aba `cpc` do relatório — não entra em nenhum
  filtro de elegibilidade.

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
   `escrever_grupos` → relatório.

**Nota:** o relatório Excel (`gravar_relatorio`) usa `df_disparo`, montado *antes* do filtro — as
abas `Base`/`Novos`/`Disparo` continuam mostrando os telefones filtrados como se fossem disparar.
A verdade sobre quem recebeu mensagem de verdade são os CSVs em `out/`, já pós-filtro.

Período padrão (`periodo_padrao`): ontem até hoje; **na segunda-feira volta três dias**, pegando a
sexta anterior. `main()` retorna `0` só se sobrou pelo menos um contato — base vazia é código `1`.

Relatório (`gravar_relatorio`, `relatorio/Base_interacoes_porto_AAAAMMDD.xlsx`): abas `Base`,
`Interagiram`, `Novos`, `Disparo` e `cpc` (só se não vazia). Nunca sobrescreve — acrescenta `_2`, `_3`
etc.

`contatos_a_processar` monta a aba `cpc`: `houve_interacao == "SIM"`, `ind_baixa` vazio e
`tag_consulta_cliente_processa_dados` preenchida — conversa avançou até essa etapa mas pode ter
ficado sem resolução, sinal pra revisão manual da corretoria. Não afeta `df_disparo` nem os CSVs.

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

Mapa de grupo → arquivo está em `OUTPUT_FILES`; a correspondência com `auto/config/dispatches.json`
é contrato (ver `contratos.md`).

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
  nunca aparece em mais de um grupo). Devolve `(grupos_filtrados, removidos_por_grupo)` —
  `removidos_por_grupo` é um `dict[grupo, list[(telefone, nome)]]` das linhas removidas de cada grupo
  (grupo sem remoção nem aparece no dict), não só um total agregado.
- Contagem de removidos vai pro stdout (`Filtro: N contato(s) removido(s)...`) **e** para o evento
  estruturado `[METRICA]` `filtro` (ver `contratos.md`), que carrega o breakdown por grupo.
- Fora de dry-run, os removidos também são gravados em
  `relatorio/filtro_removidos_AAAAMMDD[_N].csv` (`escrever_filtro_removidos`, colunas
  `telefone;nome;grupo`, separador `;`) — mesmo padrão incremental do `gravar_relatorio`, nunca
  sobrescreve. A tela
  serve o mais recente via `GET /api/filtro/ultimo-removido` (ver `app.md`).
- `CSV_PARA_GRUPO` (`contatos.py`) é o dict inverso de `OUTPUT_FILES` (nome do csv → grupo). Existe só
  para a tela conseguir mapear `auto/config/dispatches.json`'s `csv` de volta a um grupo em memória, no
  dry-run — não muda nada na geração em si.
- `GET /api/filtro` (`passos.filtro_atual()`) lista os arquivos e a contagem de telefones em
  `filtros/` **antes** de rodar, sem precisar de VPN/DB — só lê a pasta.
- Arquivos ficam em `filtros/` entre execuções — **não é descartável feito `in/`**. Um arquivo de
  filtro esquecido ali continua sendo aplicado nas rodadas seguintes; é assim de propósito (evita ter
  que reenviar a planilha toda vez), mas vale conferir a pasta se um número sumir sem explicação.

## Dry-run (pré-visualização)

`gerar(..., dry_run=True)` roda o pipeline inteiro — incluindo `aplicar_filtro` — mas pula
`clear_output_folder`/`escrever_grupos`/`gravar_relatorio`. `resultado.grupos` na volta já é a
contagem real pós-filtro, só que nunca chega a tocar `out/` nem `relatorio/`. É o modo que a tela usa
no botão "Pré-visualizar" (`app.md`).

## Pipeline do Excel — `extract.py`

Caminho manual, para quando a planilha chega pronta.

- Lê `in/*.xlsx|xlsm|xltx|xltm`, abas `TempA` e `TempB` (comparação em minúsculas).
- Cabeçalho na **linha 2**, dados a partir da **linha 3**.
- A aba tem vários blocos lado a lado: cada coluna `telefone` inicia um bloco, e as colunas `nome`,
  `tipo` e `rating` seguintes (antes do próximo `telefone`) pertencem a ele. Bloco incompleto levanta
  erro nomeando o que faltou.
- As duas abas são unificadas e deduplicadas juntas.
- Os Excels de `in/` são apagados ao final, a menos que `--manter-excel`.

## Operação B — `gerar_base_b.py` + `contatos_b.py`

> Tudo desta seção só se aplica quando a tarefa cita **Operação B**. Pedido sem citar operação, ou
> citando "disparo normal", é sobre a Operação A — seção acima. Ver `SKILL.md` → "Operação A vs.
> Operação B".

Uma segunda operação de disparo, paralela à descrita acima (chamada de Operação A quando as duas
precisam ser distinguidas). **Não compartilha regra de negócio com a A** — o que compartilha é só
mecânica pura: `normalize_phone`, `write_csv`, `clear_output_folder`, `normalize_header` e o filtro
manual, todos importados de `contatos.py`.

### Fonte de dados — planilha em `in_b/` (temporário, não é mais o banco)

**Por enquanto** a base não vem mais de `consulta_operacao_b.sql`/`b2bcustomers-db` — vem de uma
planilha xlsx solta em `in_b/` (`config.INPUT_DIR_B`). O nome do arquivo pode mudar a cada rodada;
`gerar_base_b.find_input_excels_b` pega **todos** os `*.xlsx` da pasta (glob, ordenado), então mais
de um arquivo presente é lido e concatenado, não é erro.

- `gerar_base_b.ler_planilha_b(path)` lê a primeira aba do arquivo, cabeçalho na **linha 1**, dados a
  partir da **linha 2**. Colunas esperadas (comparação por `normalize_header`, case-insensitive, em
  qualquer ordem): `phone_number`, `nome`, `prioridade` — viram `RegistroB.telefone`/`.nome`/
  `.rating`. Falta de qualquer uma levanta `ValueError` nomeando o que faltou e o cabeçalho
  encontrado. Linha com telefone e nome ambos vazios é pulada.
- Não há coluna de CPF na planilha — `RegistroB.cpf` sempre chega `None` daqui, o que deixa a camada
  de dedup por CPF (`contatos_b.py`) inerte (CPF vazio não deduplica, ver abaixo) sem precisar tocar
  nela. Se a fonte voltar a trazer CPF, basta popular `RegistroB(cpf=...)` em `ler_planilha_b`.
- `sql/consulta_operacao_b.sql` e `banco.consultar_operacao_b` continuam no repo, só não são mais
  chamados por `gerar_base_b.gerar()` — histórico de como a consulta funcionava (colunas, as duas
  etapas de `DISTINCT ON`/dedup por `created_at`) fica preservado ali para quando a fonte voltar a
  ser o banco.
- Nenhum arquivo de `in_b/` é apagado depois de processado (diferente de `in/`, que `extract.py`
  apaga por padrão) — a planilha some da pasta só se alguém tirar na mão.

### Regras de contato — `contatos_b.py`

- **Dedup em duas camadas**, ambas mantendo a primeira ocorrência (contadas separado):
  - **Telefone** (`duplicados_telefone`): o mesmo número recebe um disparo só, mesmo em ratings
    diferentes — igual à A.
  - **CPF** (`duplicados_cpf`): a mesma pessoa (mesmo `des_cpf`, só dígitos) recebe um disparo só,
    mesmo com vários números no cadastro. CPF vazio **não** deduplica (cada telefone fica por si).
    **Inerte enquanto a fonte for a planilha de `in_b/`** (ver seção acima) — ela não traz coluna de
    CPF, então `RegistroB.cpf` chega sempre `None` e essa camada nunca dispara (`duplicados_cpf`
    sempre 0). Continua no código pronta pra quando a fonte trouxer CPF de novo.
  - `resultado.duplicados` é a soma das duas.
- **Nome**: `normalize_name_b` capitaliza (`MARIA DAS DORES` → `Maria Das Dores`) e, **sem nome,
  devolve `Cliente`** em vez de descartar a linha — é a diferença de comportamento mais importante
  em relação à A. Quantos caíram nesse caso sai no resumo e na `[METRICA]` `sem_nome`. Na base atual
  o campo vem preenchido em todos os registros e traz **só o primeiro nome**, já capitalizado, então
  o fallback é rede de segurança e não o caso comum — mas continua valendo, porque nada no cadastro
  garante o preenchimento.
- **Grupo** (`resolve_group_b`): comparação pelo **valor inteiro** do rating, não pela primeira
  letra — `MENOR_500` e `MAIOR_500` começam igual e a regra da A juntaria os dois. `RATING_GROUPS_B`:
  `A`, `D`, `MENOR_500`, `MAIOR_500`, `OUTROS`.
- **Rating fora da lista ou vazio** cai em `b_outros.csv` (a planilha coringa), é contado em
  `ratings_desconhecidos` e sai como `AVISO:` no resumo — não interrompe a geração.
- Saída em `out_b/` (`config.OUTPUT_DIR_B`), nunca em `out/`: cada operação limpa e reescreve só a
  própria pasta. `OUTPUT_FILES_B`/`CSV_PARA_GRUPO_B` são os equivalentes de `OUTPUT_FILES`/
  `CSV_PARA_GRUPO` (ver `contratos.md`).

### Pipeline

`gerar_base_b.gerar(dry_run, deve_cancelar)` — mesma forma da `gerar()` da A (imprime em stdout,
emite `[METRICA]`, levanta `OperacaoCancelada` nos pontos de checagem), com três diferenças: não
tem período, **não gera relatório Excel — permanentemente, de propósito** (a planilha de `in_b/` já
é a base fechada; não existe `com_relatorio` e não deve passar a existir), e por isso não tem esse
parâmetro. Sem nenhum `*.xlsx` em `in_b/`, `gerar()` levanta `FileNotFoundError` em vez de seguir
com base vazia.
Métricas emitidas: `registros_operacao_b`, `contatos_validos`, `duplicados_telefone`,
`duplicados_cpf`, `sem_nome`, `filtro` (ver `contratos.md` §2b).
A única coisa que ainda pode ir pra `relatorio/` é o CSV de auditoria do filtro manual
(`filtro_removidos_*.csv`), e só quando o filtro remove algum contato. O filtro manual de `filtros/`
é o mesmo da Operação A, aplicado do mesmo jeito. CLI: `python gerar_base_b.py [--previa]` — sem
`--previa` grava os CSVs em `out_b/` e não dispara nada; `--previa` só imprime as contagens.

## Ao mexer aqui

- Mudou regra de elegibilidade, bucket ou período: atualize este arquivo **e** a seção
  "Regras de elegibilidade" do `README.md`.
- Mudou nome ou conjunto de CSVs: veja o checklist em `contratos.md` — são quatro lugares (e o
  conjunto da Operação B tem o próprio, na mesma seção).
- Regra da Operação A não vale automaticamente para a B e vice-versa: elas são separadas de
  propósito. Mudança que precisa valer nas duas se faz nos dois arquivos, conscientemente.
- `gerar_base.py` precisa continuar imprimindo em `stdout` e expondo `gerar()` com essa assinatura:
  a tela depende disso (ver `app.md`).
