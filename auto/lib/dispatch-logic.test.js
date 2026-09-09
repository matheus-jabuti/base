const assert = require('assert');
const { parseHora, buildDispatchName, buildTemplateName, listOptionRegex, templateOptionRegex, parseFases, targetDateTime, horarioAgendamento, MARGEM_AGENDAMENTO_MS, formatDateISO, formatDuracao } = require('./dispatch-logic');

const { hh, mm } = parseHora('09:30');
assert.strictEqual(hh, 9);
assert.strictEqual(mm, 30);
assert.throws(() => parseHora('25:99'));
assert.throws(() => parseHora('abc'));

const date = new Date(2026, 7, 12); // 12/08/2026
assert.strictEqual(
  buildDispatchName('Disparo amigavel A/B/W', date, hh, mm),
  'Disparo amigavel A/B/W - 12/08/2026 - 09H30'
);
assert.strictEqual(formatDateISO(date), '2026-08-12');

const nomeContencioso = 'Disparo contencioso - 12/08/2026 - 15H15';
const optRe = listOptionRegex(nomeContencioso);
assert.ok(optRe.test(`${nomeContencioso} - (1.153 registros)`)); // separador de milhar
assert.ok(optRe.test(`${nomeContencioso} - (284 registros)`));
assert.ok(optRe.test(`${nomeContencioso} - (1 registro)`));
assert.ok(!optRe.test(`${nomeContencioso} - 15H16 - (1 registros)`)); // outro horário não casa
assert.ok(!optRe.test(nomeContencioso));

assert.strictEqual(buildTemplateName('WPP_A_E_B', '08'), 'WPP_A_E_B_08');
assert.strictEqual(buildTemplateName('WPP_contencioso', 4), 'WPP_contencioso_04'); // completa com zero
assert.strictEqual(buildTemplateName('WPP_rating_c', '123'), 'WPP_rating_c_123'); // acima de 99 nao trunca
assert.throws(() => buildTemplateName('', '08'));
assert.throws(() => buildTemplateName('WPP_A_E_B', ''));
assert.throws(() => buildTemplateName('WPP_A_E_B', '8a'));

// Template casa sem diferenciar caixa: a plataforma tem WPP_contencioso_04 em
// minusculo mas WPP_CONTENCIOSO_01 em maiusculo.
const tplRe = templateOptionRegex('WPP_contencioso_04');
assert.ok(tplRe.test('WPP_contencioso_04'));
assert.ok(templateOptionRegex('WPP_contencioso_01').test('WPP_CONTENCIOSO_01'));
assert.ok(!tplRe.test('WPP_contencioso_04 (rascunho)')); // ancorado nas pontas
assert.ok(!templateOptionRegex('WPP_contencioso_04').test('wpp_jabuti_contencioso_04')); // familia diferente
assert.ok(!templateOptionRegex('WPP_contencioso_1').test('WPP_contencioso_10'));

assert.deepStrictEqual(parseFases('lista,campanha,transmissao'), ['lista', 'campanha', 'transmissao']);
assert.deepStrictEqual(parseFases('transmissao, lista'), ['lista', 'transmissao']); // reordena pra ordem canonica
assert.deepStrictEqual(parseFases('CAMPANHA'), ['campanha']); // case-insensitive
assert.deepStrictEqual(parseFases('lista,lista'), ['lista']); // dedupe
assert.throws(() => parseFases(''));
assert.throws(() => parseFases('lista,foo'));

const target = targetDateTime(date, hh, mm);
// Folga maior que a margem: agenda no horário pedido.
assert.strictEqual(
  horarioAgendamento(target, new Date(target.getTime() - 30 * 60 * 1000)).getTime(),
  target.getTime()
);
// Horário já passou: empurra pra now + margem.
const nowPassou = new Date(target.getTime() + 5 * 60 * 1000);
assert.strictEqual(
  horarioAgendamento(target, nowPassou).getTime(),
  nowPassou.getTime() + MARGEM_AGENDAMENTO_MS
);
// Perto demais (dentro da margem): também empurra pra now + margem.
const nowPerto = new Date(target.getTime() - 3 * 60 * 1000);
assert.strictEqual(
  horarioAgendamento(target, nowPerto).getTime(),
  nowPerto.getTime() + MARGEM_AGENDAMENTO_MS
);

assert.strictEqual(formatDuracao(400), '0s');
assert.strictEqual(formatDuracao(45000), '45s');
assert.strictEqual(formatDuracao(75000), '1m15s');
assert.strictEqual(formatDuracao(3661000), '1h01m01s');

console.log('dispatch-logic: OK');
