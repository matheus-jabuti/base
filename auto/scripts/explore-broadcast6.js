const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts', { waitUntil: 'networkidle' });
  await page.locator('button:has-text("Nova Transmissão")').first().click();
  await page.waitForTimeout(600);

  const modalLike = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('*'))
      .filter(e => /modal|dialog|drawer/i.test(e.className || ''))
      .map(e => ({ tag: e.tagName, cls: e.className }));
  });
  console.log('modal-like elements:', JSON.stringify(modalLike, null, 2));

  const allInputsNow = await page.$$eval('input', els => els.map(e => ({ name: e.name, type: e.type })));
  console.log('inputs now:', JSON.stringify(allInputsNow, null, 2));

  await browser.close();
})();
