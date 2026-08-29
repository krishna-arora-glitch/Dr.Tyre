/**
 * scenarios.js
 * Applies specific overrides to the simulation state based on the selected demo scenario.
 */

export function applyScenario(scenarioId, cars, state) {
  const userCar = cars.find(c => c.isUser);
  
  if (!userCar) return;

  switch (scenarioId) {
    case 'NORMAL':
      // Default initialization, no overrides needed
      break;
      
    case 'UNDERCUT':
      // Force user to be right behind someone approaching the pit window
      // Let's set lap to 28, user on mediums
      state.lap = 28;
      state.totalLaps = 61;
      
      // Make P7 (car ahead) on old softs, 1.0s ahead
      const p7 = cars.find(c => c.position === 7);
      if (p7) {
        p7.compound = 'SOFT';
        p7.tyreAge = 18;
      }
      
      userCar.compound = 'MEDIUM';
      userCar.tyreAge = 28;
      userCar.position = 8;
      
      // Compress time gap between P7 and P8
      if (p7) {
        userCar.totalRaceTime = p7.totalRaceTime + 1.0;
      }
      break;
      
    case 'SAFETY_CAR':
      // Start just before the pit window, and queue a safety car
      state.lap = 27;
      userCar.compound = 'MEDIUM';
      userCar.tyreAge = 27;
      
      // Queue SC event in 1 lap
      state.queuedEvents = [
        { lap: 28, type: 'SC', duration: 3 }
      ];
      break;

    case 'HIGH_DEG':
      // Start user on very old softs to demonstrate high degradation curve
      state.lap = 15;
      userCar.compound = 'SOFT';
      userCar.tyreAge = 15;
      break;
      
    case 'FUEL_SAVE':
      // Give user marginal fuel 
      state.lap = 40;
      userCar.compound = 'HARD';
      userCar.tyreAge = 15;
      // Normal fuel for lap 40 is ~ 40kg left. Give them 33kg (deficit).
      userCar.fuelPct = 30; // 30% of 110kg = 33kg
      break;
  }
}
