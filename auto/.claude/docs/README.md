Este projeto é focado em automatizar a parte de disparos; para isso, utilizaremos o Playwright. Ele deverá seguir alguns padrões: registrar o tipo de disparo (se é migração ou contencioso), o horário e o dia em que foi realizado. Além disso, o sistema deve acessar a plataforma; caso já esteja logado, ele continua, e caso contrário, realiza o login via Microsoft ou com usuário e senha. A ideia é que, após cada disparo, os dados sejam atualizados em um arquivo CSV para acompanhar o progresso dos envios. O fluxo consiste em criar a campanha, subir a distribuição e, por fim, executar a parte de disparos.

## Atualização — cenário de 5 disparos por rodada

O cenário real passou a ser 5 disparos por execução, um por base: `Disparo amigavel A/B/W`,
`Disparo amigavel C`, `Disparo amigavel D/E/Z`, `Disparo amigavel N/A Rating`, `Disparo contencioso`.
Cada base tem CSV e template próprios, configurados em `config/dispatches.json` (sem precisar tocar
código para trocar template ou trocar base). O template fica quebrado em `template_prefix` +
`template_numero`, porque na prática só o número muda de uma rodada pra outra. O horário vem do
`--hora HH:MM` (ou é perguntado no terminal quando a flag não vem) e é aplicado aos 5; se ao preencher
o formulário de transmissão o horário alvo já estiver a menos de ~2min
(ou já tiver passado — ex: upload de lista demorou), a transmissão é enviada na hora em vez de agendada.
Nome/descrição de lista, campanha e transmissão usam a descrição `by automação` para identificar o que
veio da automação. Implementação: `dispatch.js` (orquestração) + `lib/dispatch-logic.js` (lógica pura,
testável via `npm test`). Log de progresso em `logs/disparos.csv`.

## Atualização — junção com a geração de base

O `auto/` passou a viver dentro do repo `base`, junto do pipeline Python que gera os CSVs. Os CSVs não
são mais copiados na mão: `dispatch.js` lê direto de `../out/` (`--bases-dir`), que é onde o
`gerar_base.py` escreve. Os `bases/*.csv` com um contato só continuam existindo, agora como fonte do
modo teste. A tela em `../app/` é o caminho normal de uso: um menu onde se escolhe o número do template
de cada tipo e o horário, e um clique que encadeia VPN → gerar base → disparar, virando uma tela de
progresso. Para a tela conseguir acompanhar base a base, o `dispatch.js` imprime linhas
`[ETAPA] {json}` no stdout (eventos `plano`, `login` e `base`); o resto do stdout continua sendo log
solto. O `node dispatch.js --hora HH:MM` continua funcionando sozinho no terminal.
