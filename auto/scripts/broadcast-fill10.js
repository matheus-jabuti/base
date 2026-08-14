const { chromium } = require('playwright');

const NAME = 'Amigavel_07-08-2026_16h25';

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
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'scripts/out/38-template-options.png', fullPage: true });

  const tplOptions = await page.getByRole('option').allTextContents();
  console.log('TEMPLATE OPTIONS:', JSON.stringify(tplOptions, null, 2));

  await browser.close();
})();
