const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/conversations', { waitUntil: 'networkidle' });

  // open account selector
  await page.click('text=Selecione uma conta');
  await page.screenshot({ path: 'scripts/out/04-account-selector.png', fullPage: true });

  const options = await page.$$eval('[role="option"], li, div', els =>
    els.map(e => e.innerText?.trim()).filter(t => t && t.length > 0 && t.length < 40)
  );
  console.log('ACCOUNT OPTIONS (sample):', JSON.stringify([...new Set(options)].slice(0, 40), null, 2));

  await browser.close();
})();
