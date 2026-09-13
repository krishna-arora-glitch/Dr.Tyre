import { AlertPriority } from './alertPriority.js';
import { evaluate_undercut } from './strategy.js';

/**
 * Core Race Intelligence Engine
 * Evaluates the simulation state and generates tactical alerts for the user's car.
 */
export function generateRaceIntelligence(userCar, allCars, simLap) {
  const alerts = [];
  
  if (!userCar) return alerts;

  const sortedCars = [...allCars].sort((a, b) => a.raceTime - b.raceTime);
  const userIndex = sortedCars.findIndex(c => c.id === userCar.id);
  
  if (userIndex > 0) {
    const carAhead = sortedCars[userIndex - 1];
    const gapAhead = userCar.raceTime - carAhead.raceTime;
    
    // Overtake Probability
    const paceDelta = carAhead.lastLapTime - userCar.lastLapTime;
    if (paceDelta > 0.2 && gapAhead < 3.0) {
      let prob = Math.min(99, Math.max(10, paceDelta * 50));
      alerts.push({
        type: 'OVERTAKE',
        priority: prob > 70 ? AlertPriority.HIGH : AlertPriority.MEDIUM,
        title: `OVERTAKE P${userIndex}`,
        message: `Probability: ${Math.round(prob)}%`,
        score: prob,
        targetCar: carAhead.id
      });
    }

    // Undercut Evaluation
    if (gapAhead > 0.5 && gapAhead < 4.0 && userCar.pitStops === 0) {
      const undercutWindow = evaluate_undercut(userCar.tyreCompound, userCar.tyreAge, gapAhead, carAhead.tyreAge);
      if (undercutWindow && undercutWindow.viable) {
        alerts.push({
          type: 'UNDERCUT',
          priority: AlertPriority.HIGH,
          title: `UNDERCUT P${userIndex}`,
          message: `Window: L${simLap + 1}-L${simLap + 3}`,
          score: 85,
          targetCar: carAhead.id
        });
      }
    }
  }

  // Defend Threat
  if (userIndex < sortedCars.length - 1) {
    const carBehind = sortedCars[userIndex + 1];
    const gapBehind = carBehind.raceTime - userCar.raceTime;
    const paceDelta = userCar.lastLapTime - carBehind.lastLapTime;
    
    if (paceDelta > 0.3 && gapBehind < 5.0) {
      const lapsToCatch = gapBehind / paceDelta;
      if (lapsToCatch > 0 && lapsToCatch < 6) {
        alerts.push({
          type: 'DEFEND',
          priority: lapsToCatch < 2 ? AlertPriority.CRITICAL : AlertPriority.HIGH,
          title: `DEFEND P${userIndex + 1}`,
          message: `Threat in ${Math.ceil(lapsToCatch)} laps`,
          score: 100 - lapsToCatch * 10,
          targetCar: carBehind.id
        });
      }
    }
  }

  // Extend Stint
  if (userCar.optimalPitLap && userCar.optimalPitLap > simLap + 5) {
    // If the optimal pit lap has been extended dynamically
    alerts.push({
      type: 'EXTEND',
      priority: AlertPriority.MEDIUM,
      title: 'EXTEND STINT',
      message: `Potential: Overcut advantage`,
      score: 60
    });
  }

  return alerts;
}
