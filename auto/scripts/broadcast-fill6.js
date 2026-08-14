const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  const idFor = async (labelText) => page.evaluate((t) => {
    const label = Array.from(document.querySelectorAll('label')).find(l => l.textContent.trim() === t);
    return label ? label.getAttribute('for') : null;
  }, labelText);

  const listId = await idFor('Lista de distribuição');
  const campId = await idFor('Campanha');
  const tplId = await idFor('Template');
  console.log({ listId, campId, tplId });

  await page.locator(`#${campId}`).click();
  await page.waitForTimeout(300);
  const campOptions = await page.$$eval('[role="option"]', els => els.map(e => e.textContent.trim()));
  console.log('CAMPAIGN OPTIONS:', JSON.stringify(campOptions.slice(0, 5), null, 2));

  await browser.close();
})();
