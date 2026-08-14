const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list', { waitUntil: 'networkidle' });
  await page.click('button:has-text("Nova Lista de Distribuição")');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'scripts/out/16-new-list.png', fullPage: true });
  console.log('URL:', page.url());

  const inputs = await page.$$eval('input, textarea, select', els =>
    els.map(e => ({ tag: e.tagName, type: e.type, name: e.name, id: e.id, placeholder: e.placeholder }))
  );
  console.log('INPUTS:', JSON.stringify(inputs, null, 2));

  const buttons = await page.$$eval('button', els => els.map(e => e.innerText.trim()).filter(Boolean));
  console.log('BUTTONS:', JSON.stringify([...new Set(buttons)], null, 2));

  await browser.close();
})();
