/**
 * competitors.js
 * Generates and manages the AI competitors in the simulation.
 */
import { getRecommendation } from './strategy.js';
import { createDriverBehaviourState } from './driverBehaviour.js';

// Access modelData from window if needed, or pass it explicitly.
// Currently it expects modelData to exist globally or we can use window.modelData
const getModelData = () => window.modelData;
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

  // AI starting order — driver #11 is reserved for the user, so excluded here
  const aiStartingOrder = [1, 4, 16, 55, 81, 63, 44, 14, 18, 10, 31, 23, 22, 3, 2, 20, 27, 77, 24];
  // aiStartingOrder has exactly 19 entries (one per AI car)

  let aiIdx = 0; // tracks which AI driver to assign next

  for (let i = 0; i < 20; i++) {
    const gridSlot = i + 1; // 1-indexed grid position
    const isUser = (gridSlot === userStartingPos);
    
    let dNum, dInfo;
    if (isUser) {
      dNum = 11;
      dInfo = allDrivers.find(d => d.number === 11) || allDrivers[0];
    } else {
      dNum = aiStartingOrder[aiIdx];
      dInfo = allDrivers.find(d => d.number === dNum) || allDrivers[0];
      aiIdx++;
    }
    
    // Assign compound (mix of M and H)
    const compound = (i < 10) ? 'MEDIUM' : 'HARD';

    // Competitor Digital Twin: Use exported LME base pace if available
    let compoundBasePace = basePace;
    const modelData = getModelData();
    if (modelData && modelData.compounds && modelData.compounds[compound]) {
        compoundBasePace = modelData.compounds[compound].base_pace;
    }

    const performanceOffset = (i) * 0.15; // 0.15s slower per grid slot
    let aiBaseLapTime = compoundBasePace + performanceOffset;

    // Randomize Setup
    const downforceLevels = ['LOW', 'MEDIUM', 'HIGH'];
    const balances = ['FRONT', 'BALANCED', 'REAR'];
    const energies = ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'];
    const setup = {
      downforceLevel: downforceLevels[Math.floor(Math.random() * downforceLevels.length)],
      balance: balances[Math.floor(Math.random() * balances.length)],
      energy: { deploymentStrategy: energies[Math.floor(Math.random() * energies.length)] }
    };

    let setupOffset = 0;
    if (setup.downforceLevel === 'HIGH') setupOffset -= 1.2;
    if (setup.downforceLevel === 'LOW') setupOffset += 0.8;
    if (setup.balance === 'FRONT' || setup.balance === 'REAR') setupOffset += 0.2;
    
    let energyOffset = 0;
    if (setup.energy.deploymentStrategy === 'AGGRESSIVE') energyOffset -= 0.8;
    if (setup.energy.deploymentStrategy === 'CONSERVATIVE') energyOffset += 0.8;

    // Small random noise to base lap time
    aiBaseLapTime += (Math.random() * 0.4 - 0.2) + setupOffset + energyOffset;
    
    grid.push({
      id: isUser ? 'USER' : `AI_${dNum}`,
      isUser: isUser,
      number: dNum,
      team: dInfo.team,
      color: isUser ? '#00e5ff' : dInfo.color,
      position: gridSlot,
      startingPos: gridSlot,
      compound: compound,
      tyreAge: 0,
      fuelPct: 100, // Starts at 100%
      setup: setup,
      baseLapTime: aiBaseLapTime,
      totalRaceTime: 0, 
      currentLap: 1,
      // Grid position: ~10m before start line, staggered
      progress: (1.0 - 0.005 - (Math.floor(i / 2) * 0.0025)) % 1.0, 
      lapsCompleted: 0,
      isPitting: false,
      pitRequested: false,
      hasLaunched: false,
      pitStops: 0,
      lane: (i % 2 === 0) ? 1 : -1, // Stagger on grid
      visualLane: (i % 2 === 0) ? 1 : -1, // Initialize visual lane
      
      // Tracking
      speed: 120,
      tyreTemp: compound === 'SOFT' ? 95 : (compound === 'HARD' ? 105 : 100),
      thermalLoad: 0,
      thermalDegradation: 0,
      thermalState: {
        tyreTemp: compound === 'SOFT' ? 95 : (compound === 'HARD' ? 105 : 100),
        optimalTemp: compound === 'SOFT' ? 95 : (compound === 'HARD' ? 105 : 100),
        blisterTemp: compound === 'SOFT' ? 106 : (compound === 'HARD' ? 116 : 112),
        deltaT: 0,
        thermalZ: 0,
        thermalPenalty: 0,
        blisterFactor: 1.0,
        overheatFactor: 1.0
      },
      lapStartTime: 0,
      lastLapTime: null,
      bestLapTime: null,
      lapTimes: [],
      driverBehaviour: createDriverBehaviourState(setup),
    });
  }
  
  return grid;
}

/**
 * AI Pit Strategy Evaluator
 * Driven by the AI Strategy Engine.
 */
export function evaluateAIPit(car, totalLaps) {
  if (car.isUser) return false;
  if (car.isPitting) return false;
  if (car.pitStops >= 2) return false; // Max 2 stops
  if (totalLaps - car.currentLap < 5) return false; // Don't pit at the very end
  
  const rec = getRecommendation(car.compound, car.tyreAge, car.currentLap, car.fuelPct, car.setup, null, car.thermalState);
  
  if (rec.state === 'PIT NOW' || rec.state === 'PIT NOW (FUEL CRITICAL)') {
    return true;
  }
  
  if (rec.state === 'PIT WINDOW') {
    // 30% chance per lap to pit inside window to spread the field
    if (Math.random() < 0.3) return true;
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
