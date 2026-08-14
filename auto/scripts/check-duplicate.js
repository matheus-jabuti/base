const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const rows = page.locator('tr', { hasText: 'Amigavel_07-08-2026_17h00' });
  const count = await rows.count();
  console.log('duplicate rows found:', count);

  await rows.nth(1).getByRole('button', { name: 'Editar' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'scripts/out/61-broadcast-edit-view.png', fullPage: true });

  const btns = await page.$$eval('button', els => els.map(e => e.innerText.trim()).filter(Boolean));
  console.log('BUTTONS:', JSON.stringify([...new Set(btns)], null, 2));

  await browser.close();
})();
