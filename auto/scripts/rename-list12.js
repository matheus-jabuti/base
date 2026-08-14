const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list', { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: 'Amigavel_07-08-2026_16h25' }).getByRole('button', { name: 'Editar' }).click();
  await page.waitForSelector('input[name="name"]:not([value=""])', { timeout: 8000 });
  await page.waitForTimeout(300);

  const full = await page.locator('textarea[name="description"]').evaluate(e => e.outerHTML);
  console.log(full);

  const fieldsetDisabled = await page.evaluate(() => {
    const ta = document.querySelector('textarea[name="description"]');
    let p = ta.parentElement;
    const chain = [];
    while (p) { chain.push({tag: p.tagName, disabled: p.disabled}); p = p.parentElement; }
    return chain.slice(0, 6);
  });
  console.log(JSON.stringify(fieldsetDisabled, null, 2));

  await browser.close();
})();
