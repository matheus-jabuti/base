const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/conversations', { waitUntil: 'networkidle' });
  await page.click('text=Selecione uma conta').catch(() => {});
  // if account already persisted in storageState, selector click may fail silently; ignore
  await page.waitForTimeout(500);

  // click the 3x3 grid icon button (first button in header)
  const headerButtons = page.locator('header button, div:has(> svg) button').first();
  await page.locator('button').first().click({ timeout: 3000 }).catch(() => {});
  await page.screenshot({ path: 'scripts/out/06-grid-menu.png', fullPage: true });

  const links = await page.$$eval('a', els => els.map(e => ({ text: e.innerText.trim(), href: e.href })));
  console.log('LINKS:', JSON.stringify(links.filter(l => l.text), null, 2));

  await browser.close();
})();
