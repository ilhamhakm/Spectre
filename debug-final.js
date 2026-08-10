const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--disable-gpu-sandbox', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  const logs = [];
  page.on('console', m => logs.push(m.text()));

  console.log('--- LOAD 1 (cold) ---');
  const t1 = Date.now();
  page.goto('http://localhost:3000', { timeout: 120000, waitUntil: 'commit' }).catch(() => {});
  await new Promise(r => setTimeout(r, 15000));
  
  // Click TRAFFIC
  await page.locator('button:has-text("TRAFFIC")').first().click();
  const tClick = Date.now();
  console.log('Clicked TRAFFIC at', (tClick - t1) + 'ms');
  
  // Wait up to 60s for roads to appear
  let roadsFound = false;
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const count = await page.evaluate(() => {
      const v = (window).__viewer;
      if (!v) return 0;
      for (let i = 0; i < v.scene.primitives.length; i++) {
        const p = v.scene.primitives.get(i);
        if (p.constructor?.name === 'PolylineCollection' && p.show) return p.length;
      }
      return 0;
    });
    if (count > 0) {
      console.log(`Roads appeared after ${(Date.now() - tClick) / 1000}s: ${count} polylines`);
      roadsFound = true;
      break;
    }
  }
  if (!roadsFound) console.log('ERROR: Roads never appeared after 60s');

  // Screenshot
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('debug-final1.png', Buffer.from(data, 'base64'));
  
  // Print relevant logs
  logs.filter(l => l.includes('traffic')).forEach(l => console.log('  ' + l));
  
  await browser.close();
})();
