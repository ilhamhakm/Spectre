const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({
    args: ['--use-gl=swiftshader', '--enable-webgl', '--disable-gpu-sandbox', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERR: ' + e.message));
  page.on('console', m => { 
    if (m.type() === 'error') errors.push('CONSOLE_ERR: ' + m.text()); 
  });

  page.goto('http://localhost:3000', { timeout: 120000, waitUntil: 'commit' }).catch(() => {});
  
  // Wait for Cesium to initialize
  await new Promise(r => setTimeout(r, 15000));
  
  // Click the TRAFFIC button to toggle it ON
  const trafficBtn = await page.locator('button:has-text("TRAFFIC")').first();
  if (trafficBtn) {
    await trafficBtn.click();
    console.log('Clicked TRAFFIC toggle');
  }
  
  // Wait for roads to load
  await new Promise(r => setTimeout(r, 15000));
  
  // Screenshot via CDP
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('debug-traffic3.png', Buffer.from(data, 'base64'));
  
  console.log('Errors:', errors.length);
  errors.slice(0, 10).forEach(e => console.log(' -', e.substring(0, 300)));
  
  // Check page state
  const bodyText = await page.evaluate(() => document.body?.innerText?.substring(0, 500));
  console.log('Body:', bodyText);
  
  await browser.close();
})();
