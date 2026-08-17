# Contratos entre as metades

As três metades não se importam: conversam por arquivo e por stdout. É exatamente por isso que
quebram em silêncio quando só um lado muda. Tudo que atravessa fronteira está aqui.

## 1. O conjunto de CSVs

O Python escreve, o Node lê, e ninguém valida a correspondência em tempo de execução além de
"o arquivo existe".

| Onde | O que declara |
| --- | --- |
| `contatos.py` → `OUTPUT_FILES` | Grupo → nome do arquivo escrito em `out/` |
| `contatos.py` → `CAMPAIGN_LABELS` | Grupo → rótulo da campanha no `copy.md` |
| `auto/config/dispatches.json` → `csv` | Nome do arquivo que cada base procura |
| `auto/bases/` | Um arquivo de mesmo nome, com um contato, para o modo teste |
| `README.md` → tabela "Saida" | O que o operador espera encontrar |

**Adicionar, remover ou renomear uma base exige tocar os cinco.** Faltando `auto/bases/`, o modo teste
quebra com "CSV nao encontrado"; faltando em `OUTPUT_FILES`, produção quebra do mesmo jeito.

Formato do arquivo, invariante: UTF-8, cabeçalho literal `phonenumber,name`, uma linha por contato,
telefone só com dígitos. `escrever_grupos` grava **todos** os arquivos, inclusive vazios — o
`dispatch.js` exige que existam, e trata CSV sem contato como `pulado`, não como erro.

## 2. `copy.md`

Escrito por `escrever_copy` com `<CAMPAIGN_LABELS[grupo]> - DD/MM/AAAA - <hora>`. O `dispatch.js`
monta o nome real com `buildDispatchName`: `<nome> - DD/MM/AAAA - HHhMM`.

São duas implementações do mesmo nome, em linguagens diferentes. O `nome` em
`auto/config/dispatches.json` precisa bater com `CAMPAIGN_LABELS`, e o formato de hora precisa
continuar equivalente — senão o copy que o operador usa não corresponde ao que foi criado no
dashboard. Mudou um lado, mude o outro.

## 3. Protocolo de progresso `[ETAPA]`

`dispatch.js` (`progresso()`) imprime no stdout:

```
[ETAPA] {"evento":"...", ...}
```

`app/passos.py:disparar` faz `JSON.parse` do resto da linha e emite como evento `etapa`. Toda linha
sem esse prefixo continua sendo log livre — o script segue legível no terminal.

| Evento | Campos | Quem consome |
| --- | --- | --- |
| `plano` | `bases[]` com `key`, `nome`, `contatos`, `template` | `app.js` escreve no log |
| `login` | `status`: `rodando` \| `ok` | `app.js` atualiza o passo `disparo` |
| `base` | `key`, `status`: `rodando` \| `ok` \| `erro` \| `pulado`; em `rodando` um `etapa` de `lista` \| `campanha` \| `transmissao`; opcionalmente `detalhe` e `modo` | `app.js:atualizarSubbase` |

Regras: o prefixo é `[ETAPA] ` com espaço (constante `MARCA_ETAPA`); o payload cabe em **uma linha**;
`key` tem que existir em `config/dispatches.json`, senão a tela não acha a linha para atualizar.
Etapa nova = um `progresso()` a mais **e** o tratamento correspondente em `app.js` — evento
desconhecido é silenciosamente ignorado pela tela.

## 4. Códigos de saída

- `gerar_base.py`: `0` só quando sobrou pelo menos um contato; base vazia é `1`.
- `dispatch.js`: `1` se qualquer base falhou (erro por base não derruba as outras), `1` em erro fatal
  depois de imprimir `[FATAL] <mensagem>`. É por esse código que a tela marca o passo como erro —
  não perca o `process.exitCode`.

## 5. `auto/config/dispatches.json`

Escrito por dois lados: à mão (estrutura) e pela tela (`PUT /api/templates`).

- A tela só pode alterar `template_prefix` e `template_numero`; `key`, `nome` e `csv` são estrutura e
  são reescritos a partir do arquivo atual.
- `template_numero` é validado duas vezes, com a mesma regra: `gravar_templates` em Python
  (1 a 3 dígitos, `zfill(2)`) e `buildTemplateName` em JS. Mudou a regra, mude os dois.
- O arquivo é regravado com `indent=2` e `ensure_ascii=False`; mantenha assim para o diff ficar limpo.

## 6. A hora

Um único `HH:MM` atravessa tudo: `copy.md`, nome de lista/campanha/transmissão e o agendamento.
A tela valida e normaliza, passa como `--hora HH:MM` ao `dispatch.js` e converte para `HHh` no
`copy.md` (`hora.replace(":", "H")`).

A decisão agendado × imediato (buffer de ~2min) existe em dois lugares: `decideMode`
(`auto/lib/dispatch-logic.js`), que **decide**, e `agendado()` (`app/static/app.js`), que só **avisa**
o operador. Mudou o buffer, mude os dois — e o `README.md`, que cita o comportamento.

## 7. `auto/logs/disparos.csv`

Escrito por `logDispatch` (concatenação simples, sem escaping) e lido por `app/passos.py:ultimos_disparos`
para a tabela de histórico em `app.js`. Colunas, em ordem: `data`, `hora_alvo`, `tipo`, `nome`, `modo`,
`hora_execucao`, `status`, `detalhe`. A coluna se chama `tipo` mas recebe a `key` da base.

Mudou coluna: ajuste o header em `ensureLogFile`, o `logDispatch` e as células em `app.js`.

## 8. A tela chama o pipeline como código

`app/passos.py:gerar_base` importa `gerar_base` e chama `gerar(data_inicio, data_fim, hora,
com_relatorio, com_copy)` capturando o `stdout`. Consequências:

- Manter a assinatura de `gerar()` e o retorno com `.total_contatos`.
- Manter o pipeline **imprimindo** o progresso: `print` é a interface de log usada pela tela.
- Nada de `input()` ou qualquer bloqueio interativo no caminho de `gerar()`.

O `dispatch.js` tem a mesma restrição em espírito: só pergunta no terminal quando `--hora` não vem, e a
tela sempre passa a flag.
