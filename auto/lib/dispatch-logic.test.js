const assert = require('assert');
const { parseHora, buildDispatchName, listOptionRegex, targetDateTime, decideMode, formatDateISO } = require('./dispatch-logic');

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

const target = targetDateTime(date, hh, mm);
assert.strictEqual(decideMode(target, new Date(target.getTime() + 10 * 60 * 1000)), 'imediato');
assert.strictEqual(decideMode(target, new Date(target.getTime() - 10 * 60 * 1000)), 'agendado');
assert.strictEqual(decideMode(target, new Date(target.getTime() - 30 * 1000)), 'imediato'); // dentro do buffer

console.log('dispatch-logic: OK');
