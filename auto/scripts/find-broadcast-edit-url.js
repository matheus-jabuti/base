const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const rows = page.locator('tr', { hasText: 'Amigavel_07-08-2026_17h00' });
  const count = await rows.count();
  console.log('rows', count);

  for (let i = 0; i < count; i++) {
    const href = await rows.nth(i).locator('a').first().getAttribute('href').catch(() => null);
    console.log(i, href);
  }

  await browser.close();
})();
