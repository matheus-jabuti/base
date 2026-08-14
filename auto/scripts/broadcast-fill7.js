const { chromium } = require('playwright');

const NAME_OPTION = 'Amigavel_07-08-2026_16h25 - (1 registros)';

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
  await page.getByText(NAME_OPTION, { exact: true }).click();
  await page.waitForTimeout(300);

  const campId = await idFor('Campanha');
  await page.locator(`#${campId}`).click();
  await page.getByText(NAME_OPTION, { exact: true }).click();
  await page.waitForTimeout(300);

  const tplId = await idFor('Template');
  await page.locator(`#${tplId}`).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/34-template-open.png', fullPage: true });

  const tplOptions = await page.$$eval('[role="option"]', els => els.map(e => e.textContent.trim()));
  console.log('TEMPLATE OPTIONS:', JSON.stringify(tplOptions, null, 2));

  await browser.close();
})();
