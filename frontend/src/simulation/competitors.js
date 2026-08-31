/**
 * competitors.js
 * Generates and manages the AI competitors in the simulation.
 */

const TEAMS = [
  { name: 'Red Bull', color: '#3671C6', drivers: [1, 11] },
  { name: 'Mercedes', color: '#27F4D2', drivers: [44, 63] },
  { name: 'Ferrari', color: '#E8002D', drivers: [16, 55] },
  { name: 'McLaren', color: '#FF8000', drivers: [4, 81] },
  { name: 'Aston Martin', color: '#229971', drivers: [14, 18] },
  { name: 'Alpine', color: '#0090FF', drivers: [10, 31] },
  { name: 'Williams', color: '#37BEDD', drivers: [23, 2] },
  { name: 'RB', color: '#6692FF', drivers: [3, 22] },
  { name: 'Sauber', color: '#52E252', drivers: [77, 24] },
  { name: 'Haas', color: '#B6BABD', drivers: [20, 27] },
];

export function generateGrid(userStartingPos, basePace = 94.0) {
  const grid = [];
  
  // Flatten drivers
  const allDrivers = [];
  TEAMS.forEach(team => {
    team.drivers.forEach(d => {
      allDrivers.push({ number: d, team: team.name, color: team.color });
    });
  });

  // Sort vaguely by expected performance for starting grid
  const startingOrder = [1, 4, 16, 55, 81, 63, 44, 11, 14, 18, 10, 31, 23, 22, 3, 2, 20, 27, 77, 24];

  for (let i = 0; i < 20; i++) {
    const isUser = (i + 1 === userStartingPos);
    
    // Pick driver based on starting order
    const dNum = isUser ? 11 : startingOrder[i];
    const dInfo = allDrivers.find(d => d.number === dNum) || allDrivers[0];
    
    // Assign compound (mix of M and H)
    const compound = (i < 10) ? 'MEDIUM' : 'HARD';

    const performanceOffset = (i) * 0.15; // 0.15s slower per grid slot
    let aiBaseLapTime = basePace + performanceOffset;

    // Randomize Setup
    const downforceLevels = ['LOW', 'MEDIUM', 'HIGH'];
    const balances = ['FRONT', 'BALANCED', 'REAR'];
    const setup = {
      downforceLevel: downforceLevels[Math.floor(Math.random() * downforceLevels.length)],
      balance: balances[Math.floor(Math.random() * balances.length)]
    };

    let setupOffset = 0;
    if (setup.downforceLevel === 'HIGH') setupOffset -= 0.3;
    if (setup.downforceLevel === 'LOW') setupOffset += 0.2;
    if (setup.balance === 'FRONT') setupOffset += 0.1;

    // Small random noise to base lap time
    aiBaseLapTime += (Math.random() * 0.4 - 0.2) + setupOffset;
    
    grid.push({
      id: isUser ? 'USER' : `AI_${dNum}`,
      isUser: isUser,
      number: dNum,
      team: dInfo.team,
      color: isUser ? '#00e5ff' : dInfo.color,
      position: i + 1,
      startingPos: i + 1,
      compound: compound,
      tyreAge: 1,
      fuelPct: 100, // Starts at 100%
      setup: setup,
      baseLapTime: aiBaseLapTime,
      totalRaceTime: (i * 1.5), // Starting gap (1.5s between cars on grid)
      currentLap: 1,
      progress: 0, // 0 to 1 around track
      lapsCompleted: 0,
      isPitting: false,
      pitStops: 0,
      lane: (i % 2 === 0) ? 1 : -1, // Stagger on grid
      
      // Tracking
      lapStartTime: 0,
      lastLapTime: null,
      bestLapTime: null,
      lapTimes: [],
    });
  }
  
  return grid;
}

/**
 * AI Pit Strategy Evaluator
 * Very simple logic: Pit if tyre is old or degradation is high.
 */
export function evaluateAIPit(car, totalLaps) {
  if (car.isUser) return false;
  if (car.isPitting) return false;
  if (car.pitStops >= 2) return false; // Max 2 stops
  if (totalLaps - car.currentLap < 5) return false; // Don't pit at the very end
  
  // Pit window for compounds (approximate)
  const windowSoft = 15;
  const windowMedium = 25;
  const windowHard = 40;
  
  let targetAge = windowMedium;
  if (car.compound === 'SOFT') targetAge = windowSoft;
  if (car.compound === 'HARD') targetAge = windowHard;
  
  // Add some randomness so they don't all pit at once
  if (car.tyreAge >= targetAge - 2 + (Math.random() * 4)) {
    return true;
  }
  return false;
}

/**
 * Returns the fresh compound for AI to pit to.
 */
export function getAIFreshCompound(currentCompound) {
  if (currentCompound === 'SOFT') return 'MEDIUM';
  if (currentCompound === 'MEDIUM') return 'HARD';
  if (currentCompound === 'HARD') return 'MEDIUM';
  return 'MEDIUM';
}
