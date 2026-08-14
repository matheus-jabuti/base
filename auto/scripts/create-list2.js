const path = require('path');
const { chromium } = require('playwright');

const NAME = 'Amigavel_07-08-2026_16h25';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json' });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', NAME);

  const csvPath = path.resolve('bases/amigavel_A.csv');
  await page.setInputFiles('input[type="file"]', csvPath);
  await page.waitForSelector('text=Arquivo CSV validado com sucesso');
  await page.screenshot({ path: 'scripts/out/22-list2-preview.png', fullPage: true });

  await page.click('button:has-text("Salvar Lista de Distribuição")');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'scripts/out/23-list2-saved.png', fullPage: true });
  console.log('URL after save:', page.url());

  await browser.close();
})();
