const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/conversations', { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  await page.mouse.click(1178, 35);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/out/07-grid-clicked.png', fullPage: true });

  const links = await page.$$eval('a', els => els.map(e => ({ text: e.innerText.trim(), href: e.href })));
  console.log('LINKS:', JSON.stringify(links.filter(l => l.text), null, 2));

  await browser.close();
})();
