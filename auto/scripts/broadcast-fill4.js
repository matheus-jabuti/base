const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  const fieldInput = (label) => page.locator('div', { hasText: label }).filter({ has: page.locator('input') }).first().locator('input').first();

  // Lista de distribuição
  await fieldInput('Lista de distribuição').click();
  await page.getByText('Amigavel_07-08-2026_16h25 - (1 registros)').click();
  await page.waitForTimeout(300);

  // Campanha
  await fieldInput('Campanha').click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/32-campaign-combo2.png', fullPage: true });

  await browser.close();
})();
