const { chromium } = require('playwright');

const NAME = 'Amigavel_07-08-2026_17h00';
const TEMPLATE = 'WPP_A_E_B_03';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  const idFor = async (labelText) => page.evaluate((t) => {
    const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === t);
    return label ? label.getAttribute('for') : null;
  }, labelText);

  const listId = await idFor('Lista de distribuição');
  await page.locator(`#${listId}`).click();
  await page.getByRole('option', { name: `${NAME} - (1 registros)`, exact: true }).click();
  await page.waitForTimeout(400);

  const campId = await idFor('Campanha');
  await page.locator(`#${campId}`).click();
  await page.getByRole('option', { name: NAME, exact: true }).click();
  await page.waitForTimeout(400);

  const tplId = await idFor('Template');
  await page.locator(`#${tplId}`).click();
  await page.getByRole('option', { name: TEMPLATE, exact: true }).click();
  await page.waitForTimeout(400);

  await page.fill('input[name="name"]', NAME);
  await page.waitForTimeout(300);

  await page.click('button:has-text("Agendar Transmissão")');
  await page.waitForSelector('text=Agendar Evento');
  await page.waitForTimeout(300);

  await page.fill('input#date', '2026-08-07');
  await page.fill('input#time', '17:00');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'scripts/out/58-schedule-filled.png', fullPage: true });

  await page.click('button:has-text("Salvar Agendamento")');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'scripts/out/59-schedule-saved-modal.png', fullPage: true });

  await context.storageState({ path: 'scripts/out/auth.json' });
  await browser.close();
})();
