const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: 'scripts/out/auth.json', viewport: { width: 1400, height: 1000 } });
  const page = await context.newPage();

  await page.goto('https://dashboard.jabuti.ai/meta/broadcasts/add', { waitUntil: 'networkidle' });

  const structure = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('label, div, p')).filter(e =>
      ['Lista de distribuição', 'Campanha', 'Template'].includes(e.textContent.trim())
    );
    return labels.map(l => ({
      text: l.textContent.trim(),
      tag: l.tagName,
      nextTag: l.nextElementSibling ? l.nextElementSibling.tagName : null,
      parentHTML: l.parentElement.outerHTML.slice(0, 300),
    }));
  });
  console.log(JSON.stringify(structure, null, 2));

  await browser.close();
})();
