const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--disable-gpu-sandbox', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  const errors = [];
  const logs = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { 
    const txt = m.text();
    logs.push(m.type() + ': ' + txt);
    if (m.type() === 'error') errors.push('CONSOLE_ERR: ' + txt); 
  });

  page.goto('http://localhost:3000', { timeout: 120000, waitUntil: 'commit' }).catch(() => {});
  await new Promise(r => setTimeout(r, 15000));
  
  // Click TRAFFIC
  await page.locator('button:has-text("TRAFFIC")').first().click();
  console.log('Clicked TRAFFIC');
  
  // Wait for fetch to complete
  await new Promise(r => setTimeout(r, 20000));
  
  // Debug: check Cesium scene primitives
  const debug = await page.evaluate(() => {
    const v = (window).__viewer;
    if (!v) return { error: 'no viewer' };
    const primitives = v.scene.primitives;
    const result = { primitiveCount: primitives.length, details: [] };
    for (let i = 0; i < primitives.length; i++) {
      const p = primitives.get(i);
      const info = { 
        type: p.constructor?.name || 'unknown',
        show: p.show,
      };
      // Check if it's a PolylineCollection
      if (p._polylines || p.length !== undefined) {
        info.length = p.length ?? p._polylines?.length ?? 'unknown';
      }
      if (p._points || p.pointPrimitives?.length !== undefined) {
        info.pointCount = p.pointPrimitives?.length ?? 'unknown';
      }
      result.details.push(info);
    }
    // Check camera position
    const carto = v.camera.positionCartographic;
    result.camera = {
      lat: (carto.latitude * 180) / Math.PI,
      lon: (carto.longitude * 180) / Math.PI,
      height: carto.height,
    };
    // Check if roadsHandle exists
    result.hasRoadsHandle = !!(window).__roadsHandle;
    result.hasTrafficHandle = !!(window).__trafficHandle;
    return result;
  });
  console.log('Debug:', JSON.stringify(debug, null, 2));
  
  // Check for network requests
  const trafficRequests = logs.filter(l => l.includes('traffic') || l.includes('roads') || l.includes('fetch'));
  console.log('Relevant logs:', trafficRequests.length);
  trafficRequests.slice(0, 10).forEach(l => console.log(' -', l.substring(0, 200)));
  
  // Screenshot
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('debug-traffic4.png', Buffer.from(data, 'base64'));
  console.log('Screenshot saved');
  
  await browser.close();
})();
