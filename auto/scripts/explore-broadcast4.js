const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Nova Transmissão")');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/27-immediate.png', fullPage: true });

  const html = await page.evaluate(() => document.body.innerHTML.length);
  console.log('body html length', html);

  const drawers = await page.$$eval('*', els => els.filter(e => e.getAttribute && (e.getAttribute('data-portal') !== null)).map(e => e.tagName));
  console.log('portals', drawers);

  await browser.close();
})();
