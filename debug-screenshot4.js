const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--disable-gpu-sandbox', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  const logs = [];
  page.on('console', m => logs.push(m.type() + ': ' + m.text()));

  page.goto('http://localhost:3000', { timeout: 120000, waitUntil: 'commit' }).catch(() => {});
  
  // Wait 15s for Cesium init
  await new Promise(r => setTimeout(r, 15000));
  
  // Click TRAFFIC
  await page.locator('button:has-text("TRAFFIC")').first().click();
  console.log('Clicked TRAFFIC');
  
  // Wait 45s for the slow Overpass fetch to complete
  await new Promise(r => setTimeout(r, 45000));
  
  // Check primitives
  const debug = await page.evaluate(() => {
    const v = (window).__viewer;
    if (!v) return { error: 'no viewer' };
    const prims = v.scene.primitives;
    const result = { roads: null, traffic: null };
    for (let i = 0; i < prims.length; i++) {
      const p = prims.get(i);
      if (p.constructor?.name === 'PolylineCollection' && p.show) {
        result.roads = { show: p.show, length: p.length };
      }
      if (p.constructor?.name === 'PointPrimitiveCollection' && p.show) {
        result.traffic = { show: p.show, length: p.length };
      }
    }
    return result;
  });
  console.log('Primitives:', JSON.stringify(debug));
  
  // Print relevant console logs
  logs.filter(l => l.includes('traffic')).forEach(l => console.log(l));
  
  // Screenshot
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('debug-traffic5.png', Buffer.from(data, 'base64'));
  console.log('Screenshot saved');
  
  await browser.close();
})();
