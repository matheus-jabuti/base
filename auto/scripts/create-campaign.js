const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/campaigns/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', '123');
  await page.screenshot({ path: 'scripts/out/13-filled.png', fullPage: true });

  await page.click('button:has-text("Salvar Campanha")');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'scripts/out/14-saved.png', fullPage: true });
  console.log('URL after save:', page.url());

  await browser.close();
})();
