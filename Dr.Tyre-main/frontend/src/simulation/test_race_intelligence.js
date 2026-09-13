import { generateRaceIntelligence } from './raceIntelligence.js';
import { AlertPriority, sortAlertsByPriority } from './alertPriority.js';

console.log('--- Testing Race Intelligence ---');

// Mock state
const allCars = [
  { id: 1, raceTime: 100.0, lastLapTime: 90.0, tyreCompound: 'MEDIUM', tyreAge: 10, pitStops: 0 },
  { id: 11, raceTime: 101.5, lastLapTime: 89.1, tyreCompound: 'HARD', tyreAge: 5, pitStops: 0, optimalPitLap: 35 },
  { id: 4, raceTime: 104.0, lastLapTime: 88.5, tyreCompound: 'SOFT', tyreAge: 3, pitStops: 1 }
];

const userCar = allCars[1]; // Car 11
const simLap = 15;

const alerts = generateRaceIntelligence(userCar, allCars, simLap);
const sorted = sortAlertsByPriority(alerts);

console.log(`Generated ${sorted.length} alerts for Car 11`);
sorted.forEach(a => {
  console.log(`[Priority ${a.priority}] ${a.type} - ${a.title}: ${a.message} (Score: ${a.score})`);
});

if (sorted.length > 0) {
  console.log('PASS: Race Intelligence engine is operational.');
} else {
  console.log('FAIL: No alerts generated.');
}
