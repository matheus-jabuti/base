const assert = require('assert');
const { parseHora, buildDispatchName, buildTemplateName, listOptionRegex, parseFases, targetDateTime, decideMode, formatDateISO, formatDuracao } = require('./dispatch-logic');

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

assert.deepStrictEqual(parseFases('lista,campanha,transmissao'), ['lista', 'campanha', 'transmissao']);
assert.deepStrictEqual(parseFases('transmissao, lista'), ['lista', 'transmissao']); // reordena pra ordem canonica
assert.deepStrictEqual(parseFases('CAMPANHA'), ['campanha']); // case-insensitive
assert.deepStrictEqual(parseFases('lista,lista'), ['lista']); // dedupe
assert.throws(() => parseFases(''));
assert.throws(() => parseFases('lista,foo'));

const target = targetDateTime(date, hh, mm);
assert.strictEqual(decideMode(target, new Date(target.getTime() + 10 * 60 * 1000)), 'imediato');
assert.strictEqual(decideMode(target, new Date(target.getTime() - 10 * 60 * 1000)), 'agendado');
assert.strictEqual(decideMode(target, new Date(target.getTime() - 30 * 1000)), 'imediato'); // dentro do buffer

assert.strictEqual(formatDuracao(400), '0s');
assert.strictEqual(formatDuracao(45000), '45s');
assert.strictEqual(formatDuracao(75000), '1m15s');
assert.strictEqual(formatDuracao(3661000), '1h01m01s');

console.log('dispatch-logic: OK');
