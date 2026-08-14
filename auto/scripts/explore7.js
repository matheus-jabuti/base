const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta', { waitUntil: 'networkidle' });
  await page.click('text=Selecione um número');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'scripts/out/09-phone-selector.png', fullPage: true });

  const options = await page.$$eval('[role="option"], li', els => els.map(e => e.innerText?.trim()).filter(Boolean));
  console.log('PHONE OPTIONS:', JSON.stringify(options, null, 2));

  await browser.close();
})();
