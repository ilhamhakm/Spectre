Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
cd "C:\Users\USER\Documents\Spectre"

# Kill existing node processes
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep 2

# Start dev server in background
$proc = Start-Process -NoNewWindow cmd -ArgumentList "/c npm run dev" -PassThru
Write-Output "Dev server PID: $($proc.Id)"

# Wait for server
Start-Sleep 20

# Check ports
Write-Output "Port check:"
netstat -an | Select-String "LISTENING" | Select-String "300[0-9]"

# Take screenshot
node -e "
const { chromium } = require('playwright');
(async () => {
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.goto('http://localhost:3000', { timeout: 30000 });
    await page.waitForTimeout(12000);
    await page.screenshot({ path: 'debug-traffic.png' });
    console.log('Screenshot saved');
    await browser.close();
  } catch(e) {
    console.error('Screenshot error:', e.message);
  }
})();
"
