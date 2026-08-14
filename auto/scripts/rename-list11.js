const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list', { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: 'Amigavel_07-08-2026_16h25' }).getByRole('button', { name: 'Editar' }).click();
  await page.waitForSelector('input[name="name"]:not([value=""])', { timeout: 8000 });
  await page.waitForTimeout(300);

  const count = await page.locator('textarea[name="description"]').count();
  console.log('count', count);

  await page.locator('textarea[name="description"]').fill('Disparo amigavel programado');
  const v1 = await page.locator('textarea[name="description"]').inputValue();
  console.log('immediately after fill:', JSON.stringify(v1));

  await page.waitForTimeout(50);
  const v2 = await page.locator('textarea[name="description"]').inputValue();
  console.log('50ms later:', JSON.stringify(v2));

  await page.waitForTimeout(500);
  const v3 = await page.locator('textarea[name="description"]').inputValue();
  console.log('500ms later:', JSON.stringify(v3));

  await browser.close();
})();
