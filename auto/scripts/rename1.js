const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/campaigns/manage', { waitUntil: 'networkidle' });
  await page.fill('input[placeholder*="uscar" i], input[type="search"]', 'Amigavel_07').catch(()=>{});
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/out/41-campaign-search.png', fullPage: true });

  await browser.close();
})();
