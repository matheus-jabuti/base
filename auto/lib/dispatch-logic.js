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

// As 3 fases que o disparo cria no dashboard, na ordem em que rodam: campanha
// primeiro, depois a lista, depois a transmissao (que precisa das duas). E a
// mesma ordem que a equipe segue no dashboard manualmente.
const FASES_VALIDAS = ['campanha', 'lista', 'transmissao'];

// Quais fases criar. Aceita lista separada por vírgula, em qualquer ordem, e
// devolve na ordem canônica (campanha → lista → transmissao), sem repetição.
// Vazio ou nome desconhecido é erro — melhor falhar aqui do que criar menos do
// que o operador esperava.
function parseFases(texto) {
  const pedidas = String(texto == null ? '' : texto)
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);

  if (!pedidas.length) {
    throw new Error('Nenhuma fase escolhida. Use --fases lista,campanha,transmissao.');
  }

  for (const fase of pedidas) {
    if (!FASES_VALIDAS.includes(fase)) {
      throw new Error(`Fase desconhecida: "${fase}". Use lista, campanha e/ou transmissao.`);
    }
  }

  return FASES_VALIDAS.filter((fase) => pedidas.includes(fase));
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

// O nome cadastrado do template na plataforma nem sempre segue a caixa que a
// tela grava: contencioso tem WPP_contencioso_02..10 em minusculo mas
// WPP_CONTENCIOSO_01 em maiusculo. O disparo so precisa do nome certo, nao da
// caixa certa — casa sem diferenciar maiuscula/minuscula, ancorado nas pontas
// pra nao pegar template de outra familia (ex.: wpp_jabuti_contencioso_01).
function templateOptionRegex(template) {
  return new RegExp(`^${escapeRegExp(String(template).trim())}$`, 'i');
}

// Todo disparo e agendado, nunca imediato: sempre sobra uma janela pra cancelar
// no dashboard antes da mensagem sair. Se o horario escolhido ja passou, ou esta
// perto demais pra dar tempo de cancelar, agenda MARGEM_AGENDAMENTO_MS pra frente.
const MARGEM_AGENDAMENTO_MS = 10 * 60 * 1000;

function horarioAgendamento(target, now, margemMs = MARGEM_AGENDAMENTO_MS) {
  const minimo = now.getTime() + margemMs;
  return target.getTime() >= minimo ? new Date(target) : new Date(minimo);
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
  templateOptionRegex,
  FASES_VALIDAS,
  parseFases,
  targetDateTime,
  horarioAgendamento,
  MARGEM_AGENDAMENTO_MS,
  formatDuracao,
};
