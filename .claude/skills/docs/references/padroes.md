# Padrões e regras de código

## Regra zero: isso dispara mensagem para cliente real

Estabilidade e correção de dado vêm antes de elegância. Prefira evitar regressão a deixar bonito.
Antes de qualquer mudança no caminho de disparo, pergunte: se isso falhar em silêncio, alguém recebe
mensagem que não devia — ou deixa de receber?

- Nunca aponte um teste para `out/`. Modo teste é `--bases-dir bases` (ou o botão na tela).
- Não remova confirmação de sucesso do dashboard para "simplificar" (ver `disparo.md`).
- Não relaxe filtro de elegibilidade sem pedido explícito do usuário.

## Idioma

- Python (raiz, `app/`): **português sem acentos** em código, comentários, docstrings e saída de CLI.
- `auto/`: português com acentos em comentários e strings de UI; identificadores em inglês
  (`createList`, `buildDispatchName`) porque é o padrão do arquivo.
- Documentação em `.claude/` e `auto/.claude/`: português com acentos.
- `README.md`: português sem acentos, voz de manual do operador.

**Combine com o arquivo que está editando.** Não misture os dois estilos dentro de um arquivo.

## Comentários

O padrão do repo é comentário que explica **por que**, e só onde a linha sozinha engana. Exemplos que
existem e devem ser preservados:

```python
# "NAO LOCALIZADO" nao tem cadastro, entao nao ha o que cobrar.
```

```js
// domcontentloaded, não networkidle: essa tela tem dado vivo/polling e a rede
// nunca fica realmente ociosa — só precisamos ler a URL depois do redirect.
```

Não escreva comentário que repete o código. Não deixe comentário órfão depois de refatorar.

## Estrutura

- **Configuração fora do código.** Base, CSV e template vivem em `auto/config/dispatches.json`;
  credenciais e hosts no `.env`. Nada disso hardcoded.
- **Lógica pura separada.** Em `auto/`, o que dá para testar sem browser vai para
  `lib/dispatch-logic.js` e ganha caso em `lib/dispatch-logic.test.js`.
- **Regra de contato num lugar só.** Normalização, rating, dedup e escrita moram em `contatos.py`, e
  valem para os dois pipelines. Não duplique em `gerar_base.py` nem em `extract.py`.
- **`server.py` é fino.** Validação, lock e SSE. Regra vai em `passos.py`.
- **Caminhos ancorados no arquivo.** `BASE_DIR = Path(__file__).resolve().parent...` em Python,
  `__dirname` em JS. Nunca dependa do cwd — a tela roda o `dispatch.js` de outra pasta.

## Erros

- Falhe cedo e com mensagem que nomeia o que faltou: `require_env` diz qual variável, `resolverBases`
  diz qual CSV, `find_blocks` diz quais colunas.
- Nunca deixe erro cru chegar na tela. `dispatch.js` fecha com `[FATAL] <mensagem>` numa linha;
  `passos.py` converte exceção de thread em linha de log em vez de derrubar o servidor.
- Erro por base não pode derrubar as outras quatro — try/catch por base — **mas** o processo tem que
  sair com código diferente de zero para a tela saber.
- No Playwright, `waitForLoadState`/`waitForTimeout` não são prova de sucesso. Confirme o sinal real.

## Dados

- Tudo que sai do banco vem como texto (`dtype="str"`) e passa por `strip`. Não presuma número.
- Comparação de `bucket` e `tipo` é feita em minúsculas, com `strip` — mantenha assim: os valores vêm
  de JSON de terceiro e variam em acentuação e caixa.
- Telefone é sequência de dígitos, nunca `int` (perde zero à esquerda) nem `float`.
- `out/` é descartável: apagada e reescrita a cada execução. Não guarde nada lá.

## Testes

Duas suítes, uma por lado. `cd auto && npm test` — `assert` puro, sem framework, sobre
`lib/dispatch-logic.js`. Toda função pura nova em `auto/` entra lá. `python -m pytest -q` — `tests/`
na raiz, cobre as regras de `contatos.py` (normalização, `resolve_group`, dedup) e `gerar_base.py`
(`periodo_padrao`, `filtrar_elegiveis`, `montar_disparo`, `preparar_novos`). Regra nova nesses dois
arquivos entra com teste em `tests/`. `.github/workflows/ci.yml` roda as duas suítes em todo push/PR.

## Refatoração

Não refatore por conta própria. Duplicação existente é aceita quando é deliberada (os dois pipelines;
o `horarioAgendamento` do `dispatch.js` e o `agendado()` da tela) — está documentada em `contratos.md`
como par a manter em sincronia. Se precisar generalizar algo, pergunte antes.

## Git — commit e push a cada alteração

**Toda alteração termina em commit enviado pro `origin`.** Tarefa concluída é árvore de trabalho limpa
e branch em dia: editar → conferir → `git add` dos arquivos tocados → commit → `git push`. Não acumule
trabalho não relacionado num commit só, e não deixe mudança pendente "para o usuário revisar" — o
commit é a unidade de revisão.

- Mensagem: Conventional Commits, **em português**, imperativo, uma linha:
  `<tipo>(<escopo>): <descrição>`.
- Tipos: `feat`, `fix`, `refactor`, `chore`, `docs`.
- Escopo é onde a mudança caiu de fato: `geracao` (Python da raiz + `sql/`), `auto`, `app`, `docs`
  (`.claude/`, `README.md`). Sem escopo quando atravessa vários sem dono claro.
- Corpo só quando o "porquê" não sai do assunto. Curto, em português.
- Terminar com `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

```
feat(app): adiciona botao de aplicar template em todas as bases
fix(geracao): trata rating desconhecido sem interromper a geracao
docs: documenta o protocolo [ETAPA] em contratos.md
```

Regras que não dobram:

- **Nunca commitar `.env`, CSV de cliente, `out/`, `relatorio/`, `filtros/`, logs.** Estão
  no `.gitignore` — mantenha, e nunca force com `git add -f`.
- `git add` dos caminhos específicos, nunca `git add -A`: há arquivo de dado não versionado ao lado.
- Fora do versionamento e assim deve continuar: `.env`, `in/`, `out/`, `relatorio/`, `filtros/`,
  `auto/node_modules/`, `auto/logs/`, `auto/scripts/out/`. `auto/bases/` **é** versionado
  de propósito.
- **Push na branch atual logo após o commit** (`git push`, com `-u` na primeira vez que a branch não
  tem upstream). Criar branch e abrir PR continua dependendo de pedido do usuário.
- Nunca `--force`. Não emendar (`--amend`) nem reescrever commit existente — faça um novo.
- Push recusado por non-fast-forward significa que alguém empurrou antes: puxe/rebase e avise, nunca force.

## Documentação

Toda mudança que afete fluxo, comando, arquivo de saída, contrato ou regra de negócio termina com a
documentação correspondente atualizada. A tabela de "mudou X → atualize Y" está no `SKILL.md`.
