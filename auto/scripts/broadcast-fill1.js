const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  await page.locator('text=Lista de distribuição').locator('..').locator('input, [role="textbox"]').first().click().catch(()=>{});
  // click the combobox itself
  await page.getByText('Lista de distribuição').first().scrollIntoViewIfNeeded();
  const listCombo = page.locator('input').nth(0);
  await listCombo.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'scripts/out/29-list-combo-open.png', fullPage: true });

  await browser.close();
})();
