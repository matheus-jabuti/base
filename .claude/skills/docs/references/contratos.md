# Contratos entre as metades

As três metades não se importam: conversam por arquivo e por stdout. É exatamente por isso que
quebram em silêncio quando só um lado muda. Tudo que atravessa fronteira está aqui.

## 1. O conjunto de CSVs

O Python escreve, o Node lê, e ninguém valida a correspondência em tempo de execução além de
"o arquivo existe".

| Onde | O que declara |
| --- | --- |
| `contatos.py` → `OUTPUT_FILES` | Grupo → nome do arquivo escrito em `out/` |
| `auto/config/dispatches.json` → `csv` | Nome do arquivo que cada base procura |
| `auto/bases/` | Um arquivo de mesmo nome, com um contato, para o modo teste |
| `README.md` → tabela "Saida" | O que o operador espera encontrar |

**Adicionar, remover ou renomear uma base exige tocar os cinco.** Faltando `auto/bases/`, o modo teste
quebra com "CSV nao encontrado"; faltando em `OUTPUT_FILES`, produção quebra do mesmo jeito.

Formato do arquivo, invariante: UTF-8, cabeçalho literal `phonenumber,name`, uma linha por contato,
telefone só com dígitos. `escrever_grupos` grava **todos** os arquivos, inclusive vazios — o
`dispatch.js` exige que existam, e trata CSV sem contato como `pulado`, não como erro.

A **Operação B** tem o conjunto próprio, com a mesma regra dos cinco lugares e o mesmo formato de
arquivo:

| Onde | O que declara |
| --- | --- |
| `contatos_b.py` → `OUTPUT_FILES_B` | Grupo → nome do arquivo escrito em `out_b/` |
| `auto/config/dispatches-b.json` → `csv` | Nome do arquivo que cada planilha procura |
| `auto/bases-b/` | Um arquivo de mesmo nome, com um contato, para o modo teste |
| `README.md` → seção "Operação B" | O que o operador espera encontrar |

Os dois conjuntos nunca se cruzam: cada operação limpa e reescreve só a própria pasta de saída.

## 2. Protocolo de progresso `[ETAPA]`

`dispatch.js` (`progresso()`) imprime no stdout:

```
[ETAPA] {"evento":"...", ...}
```

`app/passos.py:disparar` faz `JSON.parse` do resto da linha e emite como evento `etapa`. Toda linha
sem esse prefixo continua sendo log livre — o script segue legível no terminal.

| Evento | Campos | Quem consome |
| --- | --- | --- |
| `plano` | `fases[]` (fases que vão ser criadas) e `bases[]` com `key`, `nome`, `contatos`, `template` | `app.js` escreve no log |
| `login` | `status`: `rodando` \| `ok` | `app.js` atualiza o passo `disparo` |
| `base` | `key`, `status`: `rodando` \| `ok` \| `erro` \| `pulado`; em `rodando` um `etapa` de `campanha` \| `lista` \| `transmissao`; opcionalmente `detalhe`, `modo` e `fases` (em `ok`) | `app.js:atualizarSubbase` |

Regras: o prefixo é `[ETAPA] ` com espaço (constante `MARCA_ETAPA`); o payload cabe em **uma linha**;
`key` tem que existir em `config/dispatches.json`, senão a tela não acha a linha para atualizar.
Etapa nova = um `progresso()` a mais **e** o tratamento correspondente em `app.js` — evento
desconhecido é silenciosamente ignorado pela tela.

| `tempo` | `escopo`: `base` \| `fase` \| `total`; `ms` e `duracao` (já formatada por `formatDuracao`); em `escopo:base` também `chave` (`selecao`\|`envio`\|`transmissao_completa`) e `key`; em `escopo:fase` também `etapa`; em `escopo:total` opcionalmente `interrompido` | `app.js:atualizarTempo` |

## 2b. Protocolo de métricas `[METRICA]`

Mesmo esquema do `[ETAPA]`, só que emitido por `gerar_base.py` (não pelo `dispatch.js`) ao lado dos
`print()`s de sempre — aditivo, não substitui nada:

```
[METRICA] {"chave":"...", "valor":..., "rotulo":"...", ...}
```

`app/passos.py:_FilaDeLinhas` reconhece o prefixo `MARCA_METRICA = "[METRICA] "` e emite evento
`metrica` em vez de `log`. Chaves emitidas pela `gerar()` da Operação A: `conversas_periodo`,
`cadastros_localizados`, `pagamento_recente_bloqueado`, `elegiveis_apos_filtros`, `clientes_novos`,
`filtro` (esta última também carrega `telefones_filtro` e `por_grupo`, o breakdown de quantos foram
removidos por grupo). Chaves da `gerar()` da **Operação B** (`gerar_base_b.py`):
`registros_operacao_b`, `contatos_validos`, `duplicados_telefone`, `duplicados_cpf`, `sem_nome`,
`filtro`. `app.js` consome via `atualizarMetrica`, que ignora chave desconhecida (só cria um card novo
na hora); `filtro`, `pagamento_recente_bloqueado`, `duplicados_telefone` e `duplicados_cpf` aparecem
com sinal negativo (cortes do funil).

## 3. Códigos de saída

- `gerar_base.py`: `0` só quando sobrou pelo menos um contato; base vazia é `1`.
- `dispatch.js`: `1` se qualquer base falhou (erro por base não derruba as outras), `1` em erro fatal
  depois de imprimir `[FATAL] <mensagem>`. É por esse código que a tela marca o passo como erro —
  não perca o `process.exitCode`.

## 4. Template: estrutura versionada + número fora do git

O nome do template (`buildTemplateName` = `<prefixo>_<número>`) vem de dois arquivos:

| Arquivo | Git | Conteúdo |
| --- | --- | --- |
| `auto/config/dispatches.json` | versionado | Só estrutura: `key`, `nome`, `csv`, `grupo`, `template_prefix`. Editado à mão. |
| `auto/config/template-numeros.example.json` | versionado | Baseline `{ "<grupo>": "NN" }`. Muda só quando alguém troca o padrão de propósito. |
| `auto/config/template-numeros.json` | **gitignored** | O número vivo por grupo. Semeado do `.example` na 1ª leitura. Escrito pela tela e pelo agendador. |

Por que separar: o número muda quase toda rodada e sujava o `git status`/histórico.

- **Leitura**: `passos.ler_templates()` (Python) devolve a estrutura com
  `template_numero` de cada grupo sobreposto (`_ler_numeros()`, fallback `"01"`) — a forma é a mesma
  de antes, então `/api/templates`, a tela e o agendador não mudaram. `dispatch.js:lerNumeros()` faz o
  mesmo do lado Node, em `resolverBases`.
- **Escrita**: `PUT /api/templates` → `passos.gravar_templates` colapsa as entradas por base em
  `{grupo: número}` e grava **só** `template-numeros.json` (nunca `dispatches.json`). O agendador chama
  `passos.gravar_numeros_template` direto. A tela também espelha em `localStorage`
  (`disparo.templateNumeros`), ver `app.md`.
- `grupo` define o agrupamento (um número por grupo, ver `app.md`); o `PUT` continua mandando uma
  entrada por base, com o número do grupo repetido. Base sem `grupo` vira grupo próprio (campo opcional).
- O número é validado duas vezes, mesma regra: `gravar_numeros_template` em Python (1 a 3 dígitos,
  `zfill(2)`) e `buildTemplateName` em JS. Mudou a regra, mude os dois.
- Os JSONs são gravados com `indent=2` e `ensure_ascii=False`.

A **Operação B** repete o mesmo trio de arquivos, com o sufixo `-b`
(`dispatches-b.json`, `template-numeros-b.example.json`, `template-numeros-b.json` gitignored) e as
mesmas duas validações — `app/operacao_b.py:gravar_numeros_template` e `buildTemplateName`. Quem lê:
`app/operacao_b.py:ler_templates` (via `PUT`/`GET /api/b/templates`) e `dispatch.js:lerNumeros` a
partir do mapa `OPERACOES`. Lá cada uma das cinco planilhas é o próprio `grupo`, então o número é
independente por rating. O espelho no navegador é `disparo.templateNumerosB`.

## 5. A hora

Um único `HH:MM` atravessa tudo: nome de lista/campanha/transmissão e o agendamento. A tela valida
e normaliza, e passa como `--hora HH:MM` ao `dispatch.js`.

Todo disparo é **sempre agendado** (nunca envio imediato), pra sempre sobrar janela de cancelamento.
`horarioAgendamento(target, now, margem = 10min)` (`auto/lib/dispatch-logic.js`) resolve o horário:
mantém o alvo se está a 10min+ no futuro, senão agenda `now + 10min`. `agendado()`
(`app/static/app.js`) só **avisa** o operador (sempre "agendado", sinalizando quando o horário será
empurrado). Mudou a margem ou o comportamento, mude os dois — e o `README.md`, que cita.

## 6. `auto/logs/disparos.csv`

Escrito por `logDispatch` (concatenação simples, sem escaping) e lido por `app/passos.py:ultimos_disparos`
para a tabela de histórico em `app.js`. Colunas, em ordem: `data`, `hora_alvo`, `tipo`, `nome`, `modo`,
`hora_execucao`, `status`, `detalhe`. A coluna se chama `tipo` mas recebe a `key` da base.

Não há coluna de operação: as duas escrevem no mesmo log, e o que separa é o prefixo `b_` nas `key`
e nos nomes da Operação B.

Mudou coluna: ajuste o header em `ensureLogFile`, o `logDispatch` e as células em `app.js`.

## 7. A tela chama o pipeline como código

`app/passos.py:gerar_base` importa `gerar_base` e chama `gerar(data_inicio, data_fim, com_relatorio,
dry_run=..., deve_cancelar=...)` capturando o `stdout`. Os dois últimos parâmetros são opcionais com
default compatível (`dry_run=False`, `deve_cancelar=lambda: False`) — o CLI (`python gerar_base.py`)
nem sabe que existem. Consequências:

- Manter a assinatura de `gerar()` (aditiva) e o retorno com `.total_contatos`/`.grupos`.
- Manter o pipeline **imprimindo** o progresso: `print` é a interface de log usada pela tela.
- `dry_run=True` roda tudo (inclusive `aplicar_filtro`) mas não grava CSV/Excel — `resultado.grupos`
  já reflete o filtro aplicado, então a prévia é o número real pós-filtro, só não vai pro disco.
- `passos.executar` **zera `com_relatorio` quando `modo == "teste"`** antes de chamar `gerar_base` —
  ensaio não deixa Excel em `relatorio/`. É a única regra de negócio que `executar` aplica sozinho.
- `deve_cancelar` é checado (`_checar_cancelamento`) entre chamadas bloqueantes de DB/pandas, nunca
  dentro delas — cancelar no meio de uma query só surte efeito quando ela retornar. Levanta
  `OperacaoCancelada`, que `app/passos.py:gerar_base` traduz em evento `("cancelado", True)`.
- Nada de `input()` ou qualquer bloqueio interativo no caminho de `gerar()`.

O `dispatch.js` tem a mesma restrição em espírito: só pergunta no terminal quando `--hora` não vem, e a
tela sempre passa a flag.

`passos.executar` e `passos.disparar` têm um parâmetro opcional `fases: list[str] | None` (aditivo,
default `None`): quais das três fases criar (`campanha`/`lista`/`transmissao`, nessa ordem canônica —
campanha antes da lista, transmissao por último). Vira `--fases` no `dispatch.js`; `None` ou as três
não passa a flag. Só o disparo manual usa — `GET /api/executar` recebe `fases` (querystring, default
`campanha,lista,transmissao`, validado por `server._validar_fases`) e a aba Preparar tem os checkboxes.
O `agendador` chama `executar` sem `fases`, então disparo automático sempre cria as três.

O `app/agendador.py` é o segundo consumidor de `passos.executar()` (a tela é o primeiro). As mesmas
regras valem: assinatura aditiva, pipeline imprimindo o progresso, nada de `input()`. Os dois
compartilham `passos.LOCK_EXECUCAO` — só um disparo roda de cada vez. `auto/config/agenda.json`
(`{modo, itens: [{data, hora, ativo, templates}]}`) é escrito só pela aba Agenda; o `dispatch.js` não
o lê. Antes de cada disparo automático o agendador grava os números de `templates` da linha em
`template-numeros.json` (via `passos.gravar_numeros_template`) — então um disparo pela agenda
sobrescreve o que estiver salvo na rota Templates. O `modo` da agenda (default `teste`, migrado como `teste` a partir do
formato antigo) é próprio: `producao` lê `out/` e gera a base antes, `teste` lê `auto/bases/`. Não é o
mesmo `estado.modo` do toggle do topo da tela, que vale só pro disparo manual.
