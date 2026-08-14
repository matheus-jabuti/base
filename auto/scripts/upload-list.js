const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', '123');

  const csvPath = path.resolve('bases/amigavel_A.csv');
  await page.setInputFiles('input[type="file"]', csvPath);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'scripts/out/17-csv-uploaded.png', fullPage: true });

  await browser.close();
})();
