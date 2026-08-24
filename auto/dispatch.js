const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');
const {
  pad2,
  formatDateBR,
  formatDateISO,
  parseHora,
  buildDispatchName,
  buildTemplateName,
  listOptionRegex,
  targetDateTime,
  decideMode,
} = require('./lib/dispatch-logic');

// Caminhos ancorados no arquivo, nao no cwd: a tela roda o dispatch como
// subprocesso e o cwd nem sempre e auto/.
const ROOT = __dirname;
const AUTH_PATH = path.join(ROOT, 'scripts/out/auth.json');
const LOG_PATH = path.join(ROOT, 'logs/disparos.csv');
const CONFIG_PATH = path.join(ROOT, 'config/dispatches.json');
const DEFAULT_BASES_DIR = path.resolve(ROOT, '../out');
const LOGIN_URL = 'https://auth.jabuti.ai/sign-in';
const DASHBOARD_URL = 'https://dashboard.jabuti.ai/meta/campaigns/manage';
const EMAIL = process.env.JABUTI_EMAIL || 'auto-porto@jabuti.ai';
const PASSWORD = process.env.JABUTI_PASSWORD || 'porto123';
const DESCRICAO = 'by automação';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

function parseArgs(argv) {
  const args = { hora: null, basesDir: DEFAULT_BASES_DIR };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--hora') args.hora = argv[++i];
    else if (argv[i] === '--bases-dir') args.basesDir = path.resolve(argv[++i] || '');
    else throw new Error(`Argumento desconhecido: "${argv[i]}". Use --hora HH:MM [--bases-dir <pasta>].`);
  }

  return args;
}

// Conta as linhas de contato antes de abrir o browser: se um CSV vier vazio ou
// faltando, e melhor descobrir aqui do que no meio do disparo.
function contarContatos(csvPath) {
  const linhas = fs.readFileSync(csvPath, 'utf8').split('\n').filter((l) => l.trim());
  return Math.max(linhas.length - 1, 0);
}

function resolverBases(configs, basesDir) {
  if (!fs.existsSync(basesDir)) {
    throw new Error(`Pasta de bases nao encontrada: ${basesDir}`);
  }

  return configs.map((cfg) => {
    const csv = path.join(basesDir, cfg.csv);
    if (!fs.existsSync(csv)) throw new Error(`CSV nao encontrado: ${csv}`);

    return { ...cfg, csv, contatos: contarContatos(csv), template: buildTemplateName(cfg.template_prefix, cfg.template_numero) };
  });
}

// A tela acompanha o disparo pelo stdout deste processo. Uma linha [ETAPA] com
// JSON e o suficiente: quem roda no terminal continua lendo, e o server so
// precisa dar JSON.parse no resto da linha.
function progresso(dados) {
  console.log(`[ETAPA] ${JSON.stringify(dados)}`);
}

function ensureLogFile() {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true });
  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(LOG_PATH, 'data,hora_alvo,tipo,nome,modo,hora_execucao,status,detalhe\n');
  }
}

function logDispatch({ date, horaAlvo, key, nome, modo, status, detalhe }) {
  const linha = [
    formatDateBR(date),
    horaAlvo,
    key,
    nome,
    modo,
    new Date().toISOString(),
    status,
    (detalhe || '').replace(/[\n,]/g, ' '),
  ].join(',');
  fs.appendFileSync(LOG_PATH, linha + '\n');
}

async function ensureLoggedIn(browser) {
  const hasAuth = fs.existsSync(AUTH_PATH);
  let context = await browser.newContext(
    hasAuth ? { storageState: AUTH_PATH, viewport: { width: 1400, height: 1000 } } : { viewport: { width: 1400, height: 1000 } }
  );
  let page = await context.newPage();

  if (hasAuth) {
    // domcontentloaded, não networkidle: essa tela tem dado vivo/polling e a rede
    // nunca fica realmente ociosa — só precisamos ler a URL depois do redirect.
    await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    if (!page.url().includes('sign-in')) return { context, page };
    await context.close();
    context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    page = await context.newPage();
  }

  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' });
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.click('button:has-text("Entrar")');
  await page.waitForURL((url) => !url.pathname.includes('sign-in'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await context.storageState({ path: AUTH_PATH });
  return { context, page };
}

// A tela de lista NÃO redireciona ao salvar (fica no mesmo /add) — só o toast
// "Criada com sucesso" confirma que persistiu. networkidle sozinho não pega falha
// de validação/nome duplicado (o clique ainda resolve a rede, só não salva nada).
//
// O toast pode demorar mais que isso em picos de lentidão da plataforma (visto em
// execução real: form validado certinho, só o toast não chegou em 15s). Reenviar o
// formulário arrisca criar duplicata, então aqui só falha se um erro explícito
// aparecer na tela — se não apareceu nem toast nem erro, segue: createBroadcast já
// confirma a existência de verdade (com seu próprio retry de indexação) ao tentar
// selecionar a lista/campanha na transmissão.
async function confirmSavedOrWarn(page, contexto) {
  try {
    await page.waitForSelector('text=Criada com sucesso', { timeout: 30000 });
    return;
  } catch {
    const erroVisivel = await page.locator('text=/erro|já existe|inválid/i').first().isVisible().catch(() => false);
    if (erroVisivel) {
      throw new Error(`${contexto}: erro ao salvar (mensagem de erro visível na tela)`);
    }
    console.log(`[aviso] ${contexto}: toast "Criada com sucesso" não apareceu em 30s, seguindo — confirmação real acontece na transmissão.`);
  }
}

async function createList(page, nome, csv) {
  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', nome);
  await page.fill('textarea[name="description"]', DESCRICAO);
  await page.setInputFiles('input[type="file"]', path.resolve(csv));
  await page.waitForSelector('text=Arquivo CSV validado com sucesso', { timeout: 15000 });
  await page.click('button:has-text("Salvar Lista de Distribuição")');
  await confirmSavedOrWarn(page, `Lista "${nome}"`);
}

async function createCampaign(page, nome) {
  await page.goto('https://dashboard.jabuti.ai/meta/campaigns/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', nome);
  await page.fill('textarea[name="description"]', DESCRICAO);
  await page.click('button:has-text("Salvar Campanha")');
  await confirmSavedOrWarn(page, `Campanha "${nome}"`);
}

// A lista de templates cresceu (ex.: contencioso já tem 10+ opções) e o dropdown
// não renderiza tudo de cara — os itens mais abaixo (como WPP_contencioso_01) só
// aparecem depois de rolar a listbox. Sem isso, getByRole nunca encontra a opção e
// estoura timeout mesmo com o nome certo em config/dispatches.json (visto em
// scripts/out/erro-contencioso-*.png, recorrente em execuções separadas).
async function clickTemplateOption(page, template) {
  const option = page.getByRole('option', { name: template, exact: true });
  const listbox = page.getByRole('listbox');
  for (let i = 0; i < 15; i++) {
    if (await option.first().isVisible().catch(() => false)) break;
    await listbox.evaluate((el) => { el.scrollTop += el.clientHeight; }).catch(() => {});
    await page.waitForTimeout(150);
  }
  await option.first().click({ timeout: 10000 });
}

// ponytail: lista/campanha recém-criadas podem levar um tempo pra ficar
// selecionáveis no formulário de transmissão (indexação/processamento assíncrono
// do CSV). Recarrega a página e tenta de novo em vez de falhar no primeiro timeout.
async function fillBroadcastSelectors(page, { nome, template }) {
  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  const idFor = (labelText) => page.evaluate((t) => {
    const label = Array.from(document.querySelectorAll('label')).find((l) => l.textContent.trim() === t);
    return label ? label.getAttribute('for') : null;
  }, labelText);

  const listId = await idFor('Lista de distribuição');
  await page.locator(`#${listId}`).click();
  await page.getByRole('option', { name: listOptionRegex(nome) }).click({ timeout: 10000 });
  await page.waitForTimeout(400);

  const campId = await idFor('Campanha');
  await page.locator(`#${campId}`).click();
  await page.getByRole('option', { name: nome, exact: true }).click({ timeout: 10000 });
  await page.waitForTimeout(400);

  const tplId = await idFor('Template');
  await page.locator(`#${tplId}`).click();
  await clickTemplateOption(page, template);
  await page.waitForTimeout(400);
}

// Depois de "Salvar Agendamento" a página redireciona pra listagem de Transmissões
// (confirmado em scripts/out/60-after-settle.png e em execução real). "Enviar
// Transmissão" nunca foi observado antes — pode redirecionar igual, ou pode ficar na
// mesma página e só mostrar um toast (é o que acontece na tela de lista). Aceita as
// duas coisas em paralelo; o que resolver primeiro decide como confirmar.
// "Enviar Transmissão" abre um modal "Confirmar Envio" com o botão
// "Sim, confirmar envio" (visto em scripts/out/erro-amigavel_abw-*.png). Sem esse
// clique o envio nunca acontece e a espera por redirect/toast estoura o timeout.
// O caminho de agendamento nunca mostrou modal, mas se mostrar é o mesmo botão.
async function confirmModalIfPresent(page) {
  const botao = page.getByRole('button', { name: /^Sim, confirmar/i });
  try {
    await botao.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return;
  }
  await botao.click();
}

async function confirmBroadcastCreated(page, nome) {
  const redirected = page
    .waitForURL((url) => url.pathname.includes('/broadcasts') && !url.pathname.includes('/add'), { timeout: 15000 })
    .then(() => 'redirect')
    .catch(() => null);
  const toasted = page
    .waitForSelector('text=/sucesso/i', { timeout: 15000 })
    .then(() => 'toast')
    .catch(() => null);

  const [redirectResult, toastResult] = await Promise.all([redirected, toasted]);
  if (!redirectResult && !toastResult) {
    throw new Error('Nem redirecionou pra listagem de Transmissões nem mostrou toast de sucesso.');
  }
  if (redirectResult) {
    await page.locator('tr', { hasText: nome }).first().waitFor({ state: 'visible', timeout: 15000 });
  }
}

async function createBroadcast(page, { key, nome, template, target }) {
  const ATTEMPTS = 6;
  const PAUSE_MS = 10000;
  let lastErr;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      await fillBroadcastSelectors(page, { nome, template });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      progresso({ evento: 'base', key, status: 'rodando', etapa: 'transmissao', detalhe: `aguardando indexação (${i + 1}/${ATTEMPTS})` });
      console.log(`[retry] "${nome}" ainda não selecionável (tentativa ${i + 1}/${ATTEMPTS}), aguardando...`);
      if (i < ATTEMPTS - 1) await page.waitForTimeout(PAUSE_MS);
    }
  }
  if (lastErr) {
    throw new Error(`Lista/Campanha/Template não ficaram selecionáveis após ${ATTEMPTS} tentativas: ${lastErr.message}`);
  }

  await page.fill('input[name="name"]', nome);
  await page.fill('textarea[name="description"]', DESCRICAO);

  const modo = decideMode(target, new Date());
  if (modo === 'agendado') {
    await page.click('button:has-text("Agendar Transmissão")');
    await page.waitForSelector('text=Agendar Evento');
    await page.fill('input#date', formatDateISO(target));
    await page.fill('input#time', `${pad2(target.getHours())}:${pad2(target.getMinutes())}`);
    await page.click('button:has-text("Salvar Agendamento")');
    await confirmModalIfPresent(page);
    await confirmBroadcastCreated(page, nome);
  } else {
    await page.click('button:has-text("Enviar Transmissão")');
    await confirmModalIfPresent(page);
    await confirmBroadcastCreated(page, nome);
  }
  return modo;
}

async function main() {
  ensureLogFile();
  const args = parseArgs(process.argv.slice(2));
  const configs = resolverBases(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')), args.basesDir);

  const horaInput = args.hora || (await ask('Horário do disparo (HH:MM): '));
  const { hh, mm } = parseHora(horaInput);
  const today = new Date();

  console.log(`Bases: ${args.basesDir}`);
  for (const cfg of configs) {
    console.log(`  ${cfg.nome} -> ${cfg.contatos} contatos, template ${cfg.template}`);
  }

  const target = targetDateTime(today, hh, mm);
  const horaAlvoLabel = `${pad2(hh)}H${pad2(mm)}`;

  progresso({
    evento: 'plano',
    bases: configs.map((cfg) => ({ key: cfg.key, nome: cfg.nome, contatos: cfg.contatos, template: cfg.template })),
  });

  // Estado por base, carregado entre as 3 fases (lista -> campanha -> transmissao).
  // `falhou` tira a base das fases seguintes (CSV vazio ou erro definitivo apos retry).
  const estados = configs.map((cfg) => ({
    cfg,
    nome: buildDispatchName(cfg.nome, today, hh, mm),
    falhou: false,
    modo: null,
  }));

  // Lista vazia nao passa na validacao do CSV no dashboard: pula direto, sem
  // entrar em nenhuma fase.
  for (const estado of estados) {
    if (!estado.cfg.contatos) {
      estado.falhou = true;
      logDispatch({ date: today, horaAlvo: horaAlvoLabel, key: estado.cfg.key, nome: estado.nome, modo: '-', status: 'pulado', detalhe: 'CSV sem contatos' });
      progresso({ evento: 'base', key: estado.cfg.key, status: 'pulado', detalhe: 'CSV sem contatos' });
      console.log(`[PULADO] ${estado.nome}: CSV sem contatos`);
    }
  }

  let erros = 0;
  const browser = await chromium.launch({ headless: true });
  try {
    progresso({ evento: 'login', status: 'rodando' });
    const { context, page } = await ensureLoggedIn(browser);
    progresso({ evento: 'login', status: 'ok' });
    page.on('dialog', (d) => d.accept());

    // Roda uma fase (lista/campanha/transmissao) em todas as bases ainda vivas.
    // Quem falhar na primeira passada so tenta de novo no fim da fase, depois de
    // todas as outras bases - o tempo gasto com elas ja serve de folga extra pra
    // indexacao/lentidao da plataforma, sem sleep artificial. Falhou de novo, marca
    // como erro definitivo (loga, tira screenshot) e sai do jogo pras proximas fases.
    async function rodarFase(etapa, executar) {
      const vivos = estados.filter((e) => !e.falhou);
      const falharam = [];

      for (const estado of vivos) {
        progresso({ evento: 'base', key: estado.cfg.key, status: 'rodando', etapa });
        try {
          await executar(estado);
        } catch (err) {
          falharam.push(estado);
          console.log(`[retry-fase] "${estado.nome}" falhou em ${etapa} (1a tentativa): ${err.message}`);
        }
      }

      for (const estado of falharam) {
        progresso({ evento: 'base', key: estado.cfg.key, status: 'rodando', etapa, detalhe: 'retentando apos as outras bases' });
        try {
          await executar(estado);
        } catch (err) {
          estado.falhou = true;
          erros++;
          progresso({ evento: 'base', key: estado.cfg.key, status: 'erro', detalhe: err.message });
          const shotPath = path.join(ROOT, `scripts/out/erro-${estado.cfg.key}-${Date.now()}.png`);
          await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
          logDispatch({ date: today, horaAlvo: horaAlvoLabel, key: estado.cfg.key, nome: estado.nome, modo: '-', status: 'erro', detalhe: err.message });
          console.error(`[ERRO] ${estado.nome}: ${err.message} (screenshot: ${shotPath})`);
        }
      }
    }

    await rodarFase('lista', (estado) => createList(page, estado.nome, estado.cfg.csv));
    await rodarFase('campanha', (estado) => createCampaign(page, estado.nome));
    await rodarFase('transmissao', async (estado) => {
      estado.modo = await createBroadcast(page, { key: estado.cfg.key, nome: estado.nome, template: estado.cfg.template, target });
    });

    await context.storageState({ path: AUTH_PATH });
    for (const estado of estados) {
      if (estado.falhou) continue;
      logDispatch({ date: today, horaAlvo: horaAlvoLabel, key: estado.cfg.key, nome: estado.nome, modo: estado.modo, status: 'ok' });
      progresso({ evento: 'base', key: estado.cfg.key, status: 'ok', modo: estado.modo });
      console.log(`[OK] ${estado.nome} -> ${estado.modo}`);
    }
  } finally {
    await browser.close();
  }

  // Os erros por base sao capturados fase a fase pra uma falha nao derrubar as
  // outras, mas o processo precisa sair diferente de zero pra tela saber que deu problema.
  if (erros) {
    console.error(`${erros} de ${configs.length} disparos falharam.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
