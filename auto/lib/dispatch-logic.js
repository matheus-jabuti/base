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

// O template muda toda rodada, mas só no número final: WPP_A_E_B_07 -> WPP_A_E_B_08.
// Por isso o prefixo e o número ficam separados no config/dispatches.json — a tela
// edita o número sem precisar reescrever o nome inteiro e errar a digitação.
function buildTemplateName(prefix, numero) {
  const limpo = String(prefix || '').trim();
  if (!limpo) throw new Error('template_prefix vazio.');

  const digitos = String(numero == null ? '' : numero).trim();
  if (!/^\d{1,3}$/.test(digitos)) {
    throw new Error(`template_numero inválido: "${numero}". Use de 1 a 3 dígitos.`);
  }

  return `${limpo}_${pad2(Number(digitos))}`;
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

function formatDuracao(ms) {
  const totalSegundos = Math.round(ms / 1000);
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;

  if (horas > 0) return `${horas}h${pad2(minutos)}m${pad2(segundos)}s`;
  if (minutos > 0) return `${minutos}m${pad2(segundos)}s`;
  return `${segundos}s`;
}

module.exports = {
  pad2,
  formatDateBR,
  formatDateISO,
  parseHora,
  formatHoraLabel,
  buildDispatchName,
  buildTemplateName,
  listOptionRegex,
  targetDateTime,
  decideMode,
  formatDuracao,
};
