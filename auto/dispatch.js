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
  listOptionRegex,
  targetDateTime,
  decideMode,
} = require('./lib/dispatch-logic');

const AUTH_PATH = 'scripts/out/auth.json';
const LOG_PATH = 'logs/disparos.csv';
const CONFIG_PATH = 'config/dispatches.json';
const LOGIN_URL = 'https://auth.jabuti.ai/sign-in';
const DASHBOARD_URL = 'https://dashboard.jabuti.ai/meta/campaigns/manage';
const EMAIL = process.env.JABUTI_EMAIL || 'auto-porto@jabuti.ai';
const PASSWORD = process.env.JABUTI_PASSWORD || 'porto123';
const DESCRICAO = 'by automação';

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

function ensureLogFile() {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
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
async function createList(page, nome, csv) {
  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', nome);
  await page.fill('textarea[name="description"]', DESCRICAO);
  await page.setInputFiles('input[type="file"]', path.resolve(csv));
  await page.waitForSelector('text=Arquivo CSV validado com sucesso', { timeout: 15000 });
  await page.click('button:has-text("Salvar Lista de Distribuição")');
  await page.waitForSelector('text=Criada com sucesso', { timeout: 15000 });
}

async function createCampaign(page, nome) {
  await page.goto('https://dashboard.jabuti.ai/meta/campaigns/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', nome);
  await page.fill('textarea[name="description"]', DESCRICAO);
  await page.click('button:has-text("Salvar Campanha")');
  await page.waitForSelector('text=Criada com sucesso', { timeout: 15000 });
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
  await page.getByRole('option', { name: template, exact: true }).click({ timeout: 10000 });
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

async function createBroadcast(page, { nome, template, target }) {
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
  const configs = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  const horaInput = await ask('Horário do disparo (HH:MM): ');
  const { hh, mm } = parseHora(horaInput);
  const today = new Date();
  const target = targetDateTime(today, hh, mm);
  const horaAlvoLabel = `${pad2(hh)}H${pad2(mm)}`;

  const browser = await chromium.launch({ headless: true });
  try {
    const { context, page } = await ensureLoggedIn(browser);
    page.on('dialog', (d) => d.accept());

    for (const cfg of configs) {
      const nome = buildDispatchName(cfg.nome, today, hh, mm);
      try {
        await createList(page, nome, cfg.csv);
        await createCampaign(page, nome);
        const modo = await createBroadcast(page, { nome, template: cfg.template, target });
        await context.storageState({ path: AUTH_PATH });
        logDispatch({ date: today, horaAlvo: horaAlvoLabel, key: cfg.key, nome, modo, status: 'ok' });
        console.log(`[OK] ${nome} -> ${modo}`);
      } catch (err) {
        const shotPath = `scripts/out/erro-${cfg.key}-${Date.now()}.png`;
        await page.screenshot({ path: shotPath, fullPage: true }).catch(() => {});
        logDispatch({ date: today, horaAlvo: horaAlvoLabel, key: cfg.key, nome, modo: '-', status: 'erro', detalhe: err.message });
        console.error(`[ERRO] ${nome}: ${err.message} (screenshot: ${shotPath})`);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[FATAL] ${err.message}`);
  process.exit(1);
});
