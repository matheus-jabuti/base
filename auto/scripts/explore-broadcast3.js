const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Nova Transmissão")');
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/out/26-broadcast-dialog.png', fullPage: true });
  console.log('URL:', page.url());

  await browser.close();
})();
