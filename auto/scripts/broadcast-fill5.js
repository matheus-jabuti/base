const path = require('path');
const { chromium } = require('playwright');

const CAMPAIGN_NAME = 'Amigavel_07-08-2026_16h25';
const LIST_NAME = 'Amigavel_07-08-2026_16h25 - (1 registros)';

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
  await page.getByText(LIST_NAME, { exact: true }).click();
  await page.waitForTimeout(300);

  const campId = await idFor('Campanha');
  await page.locator(`#${campId}`).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/33-campaign-open.png', fullPage: true });

  const campOptions = await page.$$eval('[role="option"], .mantine-Combobox-option', els => els.map(e => e.textContent.trim()));
  console.log('CAMPAIGN OPTIONS (first 10):', JSON.stringify(campOptions.slice(0, 10), null, 2));

  await browser.close();
})();
