const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  const visibleInput = (i) => page.locator('input:visible').nth(i);

  await visibleInput(0).click(); // Lista de distribuição
  await page.getByText('Amigavel_07-08-2026_16h25 - (1 registros)').click();
  await page.waitForTimeout(300);

  await visibleInput(0).click(); // Campanha (now first visible text input again)
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/31-campaign-combo.png', fullPage: true });

  await browser.close();
})();
