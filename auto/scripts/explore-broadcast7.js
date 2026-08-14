const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/out/28-broadcast-add-page.png', fullPage: true });
  console.log('URL:', page.url());

  const inputs = await page.$$eval('input, textarea, select', els =>
    els.map(e => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id, placeholder: e.placeholder }))
  );
  console.log('INPUTS:', JSON.stringify(inputs, null, 2));

  await browser.close();
})();
