const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    
    // Wait for the track to load, click Race Control tab
    await page.waitForSelector('#tab-simulation');
    await page.click('#tab-simulation');
    
    await page.waitForSelector('#btn-start-race');
    await page.click('#btn-start-race');
    
    await new Promise(r => setTimeout(r, 2000));
    
    const debugPanel = await page.$eval('#telemetry-debug-panel', el => el.innerText).catch(() => 'No panel');
    console.log('Debug Panel:\n', debugPanel);
    
    const modelData = await page.evaluate(() => window.modelData ? Object.keys(window.modelData) : 'null');
    console.log('ModelData Keys:', modelData);
    
    const telData = await page.evaluate(() => window.telemetryData ? Object.keys(window.telemetryData) : 'null');
    console.log('TelemetryData Keys:', telData);
    
    await browser.close();
})();
