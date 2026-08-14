function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatDateBR(date) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function formatDateISO(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseHora(horaStr) {
  const m = String(horaStr).trim().match(/^(\d{1,2})[h:](\d{2})$/i);
  if (!m) throw new Error(`Horário inválido: "${horaStr}". Use HH:MM (ex: 09:30).`);
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh > 23 || mm > 59) throw new Error(`Horário inválido: "${horaStr}".`);
  return { hh, mm };
}

function formatHoraLabel(hh, mm) {
  return `${pad2(hh)}H${pad2(mm)}`;
}

function buildDispatchName(prefix, date, hh, mm) {
  return `${prefix} - ${formatDateBR(date)} - ${formatHoraLabel(hh, mm)}`;
}

function targetDateTime(baseDate, hh, mm) {
  const d = new Date(baseDate);
  d.setHours(hh, mm, 0, 0);
  return d;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A opção no combo de "Lista de distribuição" vem como
// "<nome> - (284 registros)" e, acima de mil, com separador de milhar:
// "<nome> - (1.153 registros)". Aceita ponto/vírgula no número e singular/plural.
function listOptionRegex(nome) {
  return new RegExp(`^${escapeRegExp(nome)} - \\([\\d.,]+ registros?\\)$`);
}

// ponytail: buffer fixo de 2min, virar config se precisar ajustar por base
function decideMode(target, now, bufferMs = 2 * 60 * 1000) {
  return target.getTime() - now.getTime() > bufferMs ? 'agendado' : 'imediato';
}

module.exports = {
  pad2,
  formatDateBR,
  formatDateISO,
  parseHora,
  formatHoraLabel,
  buildDispatchName,
  listOptionRegex,
  targetDateTime,
  decideMode,
};
