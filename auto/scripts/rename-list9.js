const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('PAGEERROR:', err.message));

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list', { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: 'Amigavel_07-08-2026_16h25' }).getByRole('button', { name: 'Editar' }).click();
  await page.waitForSelector('input[name="name"]:not([value=""])', { timeout: 8000 });
  await page.waitForTimeout(300);

  await page.locator('textarea[name="description"]').click();
  const activeId = await page.evaluate(() => document.activeElement.name || document.activeElement.tagName);
  console.log('active element:', activeId);

  await page.keyboard.type('abc');
  await page.waitForTimeout(300);
  const val = await page.locator('textarea[name="description"]').inputValue();
  console.log('value after keyboard type:', JSON.stringify(val));

  await browser.close();
})();
