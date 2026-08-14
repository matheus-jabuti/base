const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta', { waitUntil: 'networkidle' });
  await page.click('text=Selecione um número');
  await page.locator('text=Porto Seguro - Cobranca - 551133663970').first().click({ force: true });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/out/10-phone-selected.png', fullPage: true });
  console.log('URL:', page.url());

  const links = await page.$$eval('a', els => els.map(e => ({ text: e.innerText.trim(), href: e.href })));
  console.log('LINKS:', JSON.stringify(links.filter(l => l.text), null, 2));

  await context.storageState({ path: 'scripts/out/auth.json' });
  await browser.close();
})();
