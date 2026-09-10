---
name: docs
description: >
  Documentação completa do harness do repo `base` (geração de base Porto + disparo Playwright + tela).
  Regras, padrões e contratos entre as três metades, mais o protocolo de manutenção da própria
  documentação. Use antes de alterar qualquer código deste repo, ao responder "como funciona X",
  e obrigatoriamente depois de qualquer mudança que afete fluxo, comandos, arquivos de saída,
  contratos entre módulos ou regras de negócio.
---

# Documentação do repo `base`

Fonte da verdade escrita sobre este projeto. O código continua sendo a fonte da verdade final:
se divergir, o código vence e **este conjunto de documentos deve ser corrigido na mesma tarefa**.

## Quando ler o quê

| Documento | Leia quando |
| --- | --- |
| `references/arquitetura.md` | Visão geral: as três metades, o fluxo de ponta a ponta, mapa de arquivos |
| `references/geracao.md` | Mexer no pipeline Python (`gerar_base.py`, `extract.py`, `contatos.py`, `banco.py`, `sql/`) |
| `references/disparo.md` | Mexer na automação Playwright (`auto/`) |
| `references/app.md` | Mexer na tela (`app/server.py`, `app/passos.py`, `app/static/`) |
| `references/contratos.md` | Qualquer mudança que atravesse a fronteira entre duas metades |
| `references/padroes.md` | Antes de escrever código — convenções, estilo, o que não fazer |
| `references/operacao.md` | Rodar o projeto, modo teste, troubleshooting, o que fazer quando falha |

Documentos vizinhos que continuam válidos e **não** são duplicados aqui:

- `README.md` (raiz) — manual do operador, em português, sem acentos. Público: quem roda, não quem edita.
- `auto/CLAUDE.md` — arquitetura do disparo, lacunas intencionais, bugs achados em execução real.
- `auto/.claude/docs/fluxo-disparo.md` — passo a passo literal do dashboard (URLs, seletores, ordem).
- `CLAUDE.md` (raiz) — resumo curto carregado em todo contexto; aponta pra cá.

## Regras de uso

1. **Leia antes de escrever.** Regras de elegibilidade, agrupamento por rating, ordem das etapas do
   dashboard e os contratos entre as metades são vinculantes — não reinvente, e só mude com pedido
   explícito do usuário.
2. **Uma informação, um lugar.** Cada fato mora em exatamente um documento (ver tabela acima). Se
   precisar citar em outro, referencie o arquivo em vez de copiar o texto.
3. **Nada de número volátil.** Não escreva valores que mudam toda rodada (número de template,
   quantidade de contatos, horário). Escreva onde encontrá-los.
4. **Divergiu, corrigiu.** Achou documentação errada durante uma tarefa? Corrija junto, mesmo que
   não seja o objetivo da tarefa. Não deixe a correção pra depois.

## Protocolo de manutenção

Depois de qualquer alteração, percorra esta tabela e atualize o que estiver na coluna da direita.
Nenhuma tarefa está pronta com a documentação divergindo do código.

| Mudou | Atualize |
| --- | --- |
| Regra de elegibilidade, bucket, `ind_baixa`, período padrão | `references/geracao.md`, `README.md` (seção "Regras de elegibilidade") |
| Agrupamento por rating, normalização, dedup, nome de CSV de saída | `references/geracao.md`, `references/contratos.md`, `README.md` (tabela "Saida"), `auto/config/dispatches.json`, `auto/bases/` |
| Query em `sql/` (colunas, filtros, derivação de `tipo`) | `references/geracao.md` |
| Flag de CLI, comando, dependência | `references/operacao.md`, `README.md`, `CLAUDE.md` |
| Etapa/seletor/ordem do dashboard | `auto/.claude/docs/fluxo-disparo.md`, `references/disparo.md` |
| Evento `[ETAPA]`, endpoint HTTP, evento SSE | `references/contratos.md`, `references/app.md`, `references/disparo.md` |
| Estrutura de `auto/config/dispatches.json` ou dos arquivos `template-numeros*.json` | `references/contratos.md` (§4), `references/disparo.md`, `app/passos.py` (`ler_templates`/`gravar_numeros_template`), `auto/dispatch.js:lerNumeros` |
| Colunas de `auto/logs/disparos.csv` | `references/disparo.md`, `app/static/app.js` (tabela de histórico) |
| Convenção nova de código ou decisão de estilo | `references/padroes.md` |
| Lacuna intencional ("não fizemos X de propósito") | `auto/CLAUDE.md` → "Known gaps" |
