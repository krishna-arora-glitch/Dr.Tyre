import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        
        print("Navigating to app...")
        await page.goto("http://localhost:5173/")
        
        print("Navigating to Track Setup...")
        await page.click('text="TRACK SETUP"')
        await asyncio.sleep(1)
        
        print("Clicking Proceed to Setup...")
        await page.click('#btn-confirm-track')
        await asyncio.sleep(1)
        
        print("Clicking Start Race (Car Setup)...")
        await page.click('#btn-confirm-setup')
        await asyncio.sleep(1)
        
        print("Clicking Start Race (Race Control)...")
        await page.click('#btn-start-race')
        await asyncio.sleep(1)
        
        print("Checking Car Setup tab for disabled elements...")
        await page.click('text="CAR SETUP"')
        await asyncio.sleep(1)
        
        # Verify if elements are disabled
        btn_text = await page.text_content('#btn-confirm-setup')
        is_disabled = await page.is_disabled('#setup-tyre')
        
        print(f"Button Text: {btn_text}")
        print(f"Tyre Select Disabled: {is_disabled}")
        
        await browser.close()

asyncio.run(main())
