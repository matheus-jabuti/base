const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list', { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: 'Amigavel_07-08-2026_16h25' }).getByRole('button', { name: 'Editar' }).click();
  await page.waitForSelector('input[name="name"]:not([value=""])', { timeout: 8000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/49-list-edit-loaded.png', fullPage: true });

  const btns = await page.$$eval('button', els => els.map(e => e.innerText.trim()).filter(Boolean));
  console.log('BUTTONS:', JSON.stringify([...new Set(btns)], null, 2));

  await browser.close();
})();
