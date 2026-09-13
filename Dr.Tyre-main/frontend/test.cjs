const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
    page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
    page.on('requestfailed', req => console.log('REQ FAILED:', req.url(), req.failure()?.errorText));
    page.on('response', res => {
        if (res.status() >= 400) console.log('HTTP ERROR:', res.status(), res.url());
    });
        // 1. Confirm Track
        await page.waitForSelector('#btn-confirm-track');
        await page.click('#btn-confirm-track');
        await new Promise(r => setTimeout(r, 800));
        // 2. Click Start Simulation or tab
        const tabCheck = await page.evaluate(() => {
            const hasModel = !!window.modelData;
            const simTab = document.getElementById('tab-simulation');
            if (simTab) simTab.click();
            return { hasModel, simTabExists: !!simTab };
        });
        console.log('TAB CHECK:', tabCheck);
        await new Promise(r => setTimeout(r, 1000));
            btn.click();
            const state = window.getSimulationState();
            return {
                clicked: true,
                numCarsAfterClick: state.cars.length,
                activeAfterClick: state.active
            };
        });
        console.log('BTN CLICK RESULT:', btnClickRes);
            const data = await page.evaluate(() => {
                const userCarEl = document.querySelector('[id*="USER"]') || document.querySelector('.car-group');
                const transform = userCarEl ? userCarEl.getAttribute('transform') : 'NO_CAR_EL';
                const state = window.getSimulationState ? window.getSimulationState() : null;
                const userCar = state ? state.cars.find(c => c.isUser) : null;
                return {
                    active: state ? state.active : 'no_state',
                    userProg: userCar ? userCar.progress : 'no_user_car',
                    userSpeed: userCar ? userCar.speed : 'no_speed',
                    carTransform: transform,
                    numCars: state ? state.cars.length : 0
                };
            });
            console.log(`FRAME ${i}:`, JSON.stringify(data));
        }
    } catch (e) {
        console.error('Puppeteer error:', e);
    }
    await browser.close();
})();