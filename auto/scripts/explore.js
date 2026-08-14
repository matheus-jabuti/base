const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://auth.jabuti.ai/sign-in', { waitUntil: 'networkidle' });
  await page.fill('#email', 'auto-porto@jabuti.ai');
  await page.fill('#password', 'porto123');
  await page.click('button:has-text("Entrar")');
  await page.waitForURL(url => !url.pathname.includes('sign-in'), { timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'scripts/out/02-after-login.png', fullPage: true });
  console.log('URL after login:', page.url());

  await page.goto('https://dashboard.jabuti.ai/conversations', { waitUntil: 'networkidle' });
  await page.screenshot({ path: 'scripts/out/03-conversations.png', fullPage: true });
  console.log('URL conversations:', page.url());

  const nav = await page.$$eval('a, button', els =>
    els.map(e => e.innerText.trim()).filter(t => t.length > 0 && t.length < 40)
  );
  console.log('NAV TEXT:', JSON.stringify([...new Set(nav)], null, 2));

  await context.storageState({ path: 'scripts/out/auth.json' });
  await browser.close();
})();
