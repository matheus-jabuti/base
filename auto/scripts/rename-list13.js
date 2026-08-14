const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list', { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: 'Amigavel_07-08-2026_16h25' }).getByRole('button', { name: 'Editar' }).click();
  await page.waitForSelector('input[name="name"]:not([value=""])', { timeout: 8000 });
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const ta = document.querySelector('textarea[name="description"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, 'XYZ');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const immediately = ta.value;
    return { immediately };
  });
  console.log('sync result:', result);

  // check again after microtask/animation frame
  const after = await page.evaluate(() => new Promise(res => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      res(document.querySelector('textarea[name="description"]').value);
    }));
  }));
  console.log('after 2 rAF:', after);

  await browser.close();
})();
