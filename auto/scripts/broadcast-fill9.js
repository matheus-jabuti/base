const { chromium } = require('playwright');

const NAME_OPTION = 'Amigavel_07-08-2026_16h25 - (1 registros)';

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
  await page.locator(`#${listId}`).click();
  await page.getByRole('option', { name: NAME_OPTION, exact: true }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/out/36-after-list-select.png', fullPage: true });

  const campId = await idFor('Campanha');
  console.log('campId', campId);
  const campLoc = page.locator(`#${campId}`);
  console.log('exists?', await campLoc.count());
  await campLoc.scrollIntoViewIfNeeded();
  await campLoc.click({ force: true });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/out/37-after-campaign-click.png', fullPage: true });

  await browser.close();
})();
