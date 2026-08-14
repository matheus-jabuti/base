const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list', { waitUntil: 'networkidle' });
  await page.locator('tr', { hasText: 'Amigavel_07-08-2026_16h25' }).getByRole('button', { name: 'Editar' }).click();
  await page.waitForSelector('input[name="name"]:not([value=""])', { timeout: 8000 });
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const list = document.querySelectorAll('textarea[name="description"]');
    return Array.from(list).map(ta => {
      const desc = Object.getOwnPropertyDescriptor(ta, 'value');
      ta.value = 'DIRECT-ASSIGN';
      return {
        ownDescriptor: !!desc,
        afterDirectAssign: ta.value,
        rows: ta.rows,
        boundingRect: ta.getBoundingClientRect(),
        visible: ta.offsetParent !== null,
      };
    });
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
