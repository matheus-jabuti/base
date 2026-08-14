const path = require('path');
const { chromium } = require('playwright');

const NAME = 'Amigavel_07-08-2026_17h00';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/distribution-list/add', { waitUntil: 'networkidle' });
  await page.fill('input[name="name"]', NAME);

  const csvPath = path.resolve('bases/amigavel_A.csv');
  await page.setInputFiles('input[type="file"]', csvPath);
  await page.waitForSelector('text=Arquivo CSV validado com sucesso');
  await page.waitForTimeout(300);

  await page.click('button:has-text("Salvar Lista de Distribuição")');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'scripts/out/56-list-1700-saved.png', fullPage: true });

  await context.storageState({ path: 'scripts/out/auth.json' });
  await browser.close();
})();
