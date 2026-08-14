const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/conversations', { waitUntil: 'networkidle' });
  await page.click('text=Selecione uma conta');
  await page.click('text=Porto Cobrança - PRD');
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'scripts/out/05-account-selected.png', fullPage: true });
  console.log('URL after account select:', page.url());

  // open the grid/apps menu (top right, left of avatar)
  await page.click('button:near(:text("AP"))').catch(() => {});
  const gridButtons = await page.$$('button, [role="button"]');
  console.log('button count', gridButtons.length);

  await context.storageState({ path: 'scripts/out/auth.json' });
  await browser.close();
})();
