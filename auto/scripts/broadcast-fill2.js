const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  const listCombo = page.locator('input').nth(0);
  await listCombo.click();
  await page.getByText('Amigavel_07-08-2026_16h25 - (1 registros)').click();
  await page.waitForTimeout(300);

  const campCombo = page.locator('input').nth(1);
  await campCombo.click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/30-campaign-combo-open.png', fullPage: true });

  await browser.close();
})();
