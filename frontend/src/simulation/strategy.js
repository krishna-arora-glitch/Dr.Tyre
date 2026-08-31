/**
 * strategy.js — Pit Recommendation Engine
 * 
 * Driven by real fitted degradation curves from the pipeline.
 * Computes deterministic optimal pit laps and undercut viability.
 */
import { raceSetup } from '../setup/setup.js';

// ── Strategy Constants ───────────────────────────────────────────
export const PIT_LANE_LOSS = 24.0; // Seconds lost driving through pit lane at speed limit
export const OUT_LAP_COLD_TYRE_PENALTY = 2.0; // Seconds lost on out-lap due to cold tyres
export const SC_PIT_COST_MULTIPLIER = 0.55; // Pitting under SC loses ~45% less relative time to field
export const VSC_PIT_COST_MULTIPLIER = 0.65; // Pitting under VSC is slightly worse than SC but better than green

let modelData = null;
let currentCompound = 'MEDIUM';
let currentRaceState = 'GREEN'; // GREEN, SC, VSC
let weatherCondition = 'DRY';
let weatherMultiplier = 1.0;

export function setWeatherCondition(cond) {
  weatherCondition = cond;
  if (cond === 'WET') weatherMultiplier = 1.8;
  else if (cond === 'DAMP') weatherMultiplier = 1.3;
  else weatherMultiplier = 1.0;
}

export function initStrategy(data) {
  modelData = data;
}

export function updateStrategyCompound(compound) {
  currentCompound = compound;
}

export function setRaceState(state) {
  currentRaceState = state;
}

export const REFUEL_RATE_KG_PER_SEC = 12.0; // F1 refueling rate (circa 2009)
export const TYRE_CHANGE_TIME_SEC = 2.5;

export function getFuelBurnRate() {
  return modelData?.fuel?.burn_rate_kg_per_lap || 1.6; // kg per lap (approx 1.6% of 100kg tank)
}

export function calculateOptimalRefuelAmount(lapsRemaining) {
  if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
    return 0; // No refueling allowed
  }
  // Add a tiny 2% safety buffer
  return lapsRemaining * getFuelBurnRate() * 1.02;
}

export function getEffectivePitCost(refuelAmountKg = 0) {
  let cost = PIT_LANE_LOSS;
  
  // Calculate extra stationary time if refueling takes longer than changing tyres
  const refuelTime = refuelAmountKg / REFUEL_RATE_KG_PER_SEC;
  if (refuelTime > TYRE_CHANGE_TIME_SEC) {
    cost += (refuelTime - TYRE_CHANGE_TIME_SEC);
  }

  if (currentRaceState === 'SC') cost *= SC_PIT_COST_MULTIPLIER;
  if (currentRaceState === 'VSC') cost *= VSC_PIT_COST_MULTIPLIER;
  return cost;
}

/**
 * Get compound fit status.
 */
export function getCompoundConfidence(compound) {
  if (!modelData?.compounds?.[compound]) return { trusted: false, note: 'No data' };
  return {
    trusted: modelData.compounds[compound].trusted ?? true,
    note: modelData.compounds[compound].note || ''
  };
}

/**
 * Compute the predicted lap-time delta from tyre degradation.
 * Uses the fitted quadratic model: Δ = β₁ × age + β₂ × age²
 */
export function getDegradationDelta(compound, tyreAge, setup = null) {
  let delta = 0;
  if (!modelData?.compounds?.[compound]) {
    const rates = { SOFT: 0.12, MEDIUM: 0.07, HARD: 0.04 };
    const quads = { SOFT: 0.004, MEDIUM: 0.0015, HARD: 0.0005 };
    delta = (rates[compound] || 0.07) * tyreAge + (quads[compound] || 0.001) * tyreAge * tyreAge;
  } else {
    const c = modelData.compounds[compound];
    delta = c.deg_linear * tyreAge + c.deg_quadratic * tyreAge * tyreAge;
    
    if (c.deg_quadratic < 0) {
      const vertexAge = -c.deg_linear / (2 * c.deg_quadratic);
      if (tyreAge > vertexAge) {
        const vertexDelta = c.deg_linear * vertexAge + c.deg_quadratic * vertexAge * vertexAge;
        const fallbackLinear = 0.1;
        delta = vertexDelta + fallbackLinear * (tyreAge - vertexAge);
      }
    }
  }
  
  let setupMultiplier = 1.0;
  if (setup) {
    if (setup.downforceLevel === 'HIGH') setupMultiplier += 0.15; // high df = more wear
    if (setup.downforceLevel === 'LOW') setupMultiplier -= 0.10;
    if (setup.balance === 'FRONT') setupMultiplier += 0.05;
    if (setup.balance === 'REAR') setupMultiplier -= 0.05;
  }
  
  return Math.max(0, delta) * weatherMultiplier * setupMultiplier;
}

/**
 * Compute the marginal degradation rate at current tyre age.
 * This is the derivative: dΔ/d(age) = β₁ + 2β₂ × age
 */
export function getMarginalDegRate(compound, tyreAge, setup = null) {
  let rate = 0;
  if (!modelData?.compounds?.[compound]) {
    const rates = { SOFT: 0.12, MEDIUM: 0.07, HARD: 0.04 };
    rate = rates[compound] || 0.07;
  } else {
    const c = modelData.compounds[compound];
    if (c.deg_quadratic < 0) {
      const vertexAge = -c.deg_linear / (2 * c.deg_quadratic);
      if (tyreAge > vertexAge) {
        rate = 0.1;
      } else {
        rate = c.deg_linear + 2 * c.deg_quadratic * tyreAge;
      }
    } else {
      rate = c.deg_linear + 2 * c.deg_quadratic * tyreAge;
    }
  }
  
  let setupMultiplier = 1.0;
  if (setup) {
    if (setup.downforceLevel === 'HIGH') setupMultiplier += 0.15;
    if (setup.downforceLevel === 'LOW') setupMultiplier -= 0.10;
    if (setup.balance === 'FRONT') setupMultiplier += 0.05;
    if (setup.balance === 'REAR') setupMultiplier -= 0.05;
  }
  
  return Math.max(0, rate) * weatherMultiplier * setupMultiplier;
}

/**
 * Find the optimal stop lap over the remaining race distance by exhaustive search.
 * Goal: minimize total time = (current tyre time) + pit_cost + (fresh tyre time)
 */
export function optimal_stop_lap(currentCompound, currentTyreAge, currentRaceLap, freshCompound, currentFuelKg, setup = null) {
  const totalLaps = getTotalLaps();
  const burnRate = getFuelBurnRate();
  const currentFuelLaps = currentFuelKg / burnRate;
  
  if (currentFuelLaps < 1.0) {
    if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
      return -1; // Flag as invalid/DNF if refueling is banned
    }
    return currentRaceLap; // Force pit NOW
  }
  
  let bestLap = currentRaceLap;
  let minTotalTime = Infinity;
  
  // Calculate max laps we can do on current fuel
  const maxLapsOnCurrentFuel = Math.floor(currentFuelKg / burnRate);

  // Search every candidate stop lap from current lap to the end of the race
  for (let candidateLap = currentRaceLap; candidateLap <= totalLaps; candidateLap++) {
    const lapsOnCurrent = candidateLap - currentRaceLap;
    const lapsOnFresh = totalLaps - candidateLap;

    // If we run out of fuel before reaching this candidate lap, it's invalid
    if (lapsOnCurrent > maxLapsOnCurrentFuel) {
      continue;
    }

    let totalDelta = 0;

    // Time lost on current tyre until candidate lap
    for (let i = 0; i < lapsOnCurrent; i++) {
      totalDelta += getDegradationDelta(currentCompound, currentTyreAge + i, setup);
    }

    // Time lost if pitting
    if (lapsOnFresh > 0) {
      const fuelNeeded = calculateOptimalRefuelAmount(lapsOnFresh);
      const pitCost = getEffectivePitCost(fuelNeeded) + OUT_LAP_COLD_TYRE_PENALTY;
      totalDelta += pitCost;
      
      // Time lost on fresh tyre to end of race
      for (let i = 1; i <= lapsOnFresh; i++) {
        totalDelta += getDegradationDelta(freshCompound, i, setup);
      }
    }

    if (totalDelta < minTotalTime) {
      minTotalTime = totalDelta;
      bestLap = candidateLap;
    }
  }

  // Fallback: If we couldn't find a valid lap (e.g. we are already out of fuel), pit now
  if (minTotalTime === Infinity) {
    return currentRaceLap;
  }

  return bestLap;
}

/**
 * Evaluate if an undercut against a rival works.
 * 
 * Returns { works: boolean, net_gain_seconds: number }
 */
export function evaluate_undercut(rivalCompound, rivalTyreAge, gapToRival, lapsRemaining, freshCompound, rivalSetup = null, ourSetup = null) {
  // If we pit now, rival pits next lap.
  // We lose pit time now, but gain on the out-lap vs their in-lap.
  // Assuming a standard refuel amount for a typical stint for approximation
  const avgRefuel = calculateOptimalRefuelAmount(lapsRemaining);
  const pitCost = getEffectivePitCost(avgRefuel) + OUT_LAP_COLD_TYRE_PENALTY;
  
  // Rival time over next 2 laps (lap 1: old, lap 2: pit + fresh)
  const rivalLap1 = getDegradationDelta(rivalCompound, rivalTyreAge, rivalSetup);
  const rivalLap2 = pitCost + getDegradationDelta(freshCompound, 1, rivalSetup);
  const rivalTotal = rivalLap1 + rivalLap2;
  
  // Our time over next 2 laps (lap 1: pit + fresh, lap 2: fresh age 2)
  const ourLap1 = pitCost + getDegradationDelta(freshCompound, 1, ourSetup);
  const ourLap2 = getDegradationDelta(freshCompound, 2, ourSetup);
  const ourTotal = ourLap1 + ourLap2;
  
  // Net gain in our favor vs rival over the pit sequence
  const deltaGain = rivalTotal - ourTotal;
  
  const works = deltaGain > gapToRival;
  return { works, net_gain_seconds: deltaGain };
}

/**
 * Get pit recommendation state driven by actual strategy optimal lap and fuel.
 */
export function getRecommendation(compound, tyreAge, currentLap, fuelPct, setup = null) {
  const cInfo = getCompoundConfidence(compound);
  
  // Fuel check
  const fuelKg = (fuelPct || 1.0) * 1.1; 
  const burnRate = getFuelBurnRate();
  const fuelLaps = fuelKg / burnRate;
  
  if (fuelLaps < 1.0) {
    if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
      return {
        state: 'FUEL CRITICAL (CONSERVE)',
        optimalLap: '-',
        nextCompound: '-',
        strategyConfidence: cInfo.trusted ? 'HIGH' : 'LOW',
        confNote: 'Insufficient fuel to finish. Refuelling prohibited.',
        fuelNeeded: 0
      };
    }
    return {
      state: 'PIT NOW (FUEL CRITICAL)',
      optimalLap: currentLap,
      nextCompound: (compound === 'HARD') ? 'MEDIUM' : 'HARD',
      strategyConfidence: cInfo.trusted ? 'HIGH' : 'LOW',
      confNote: cInfo.note,
      fuelNeeded: calculateOptimalRefuelAmount(getTotalLaps() - currentLap)
    };
  }

  // Assume we switch to HARD if we are on SOFT/MEDIUM, or MEDIUM if we are on HARD
  const nextCompound = (compound === 'HARD') ? 'MEDIUM' : 'HARD';
  
  const lapsRemaining = getTotalLaps() - currentLap;
  const optimalLap = optimal_stop_lap(compound, tyreAge, currentLap, nextCompound, fuelKg, setup);
  const lapsUntilOptimal = optimalLap - currentLap;
  
  const fuelNeededIfPitNow = calculateOptimalRefuelAmount(lapsRemaining);
  
  let state, cssClass;
  
  // Hard override: If we can't complete the current lap + 1, MUST pit for fuel
  const maxLapsOnCurrentFuel = Math.floor(fuelKg / getFuelBurnRate());
  if (maxLapsOnCurrentFuel <= 1 && lapsRemaining > 0) {
    state = 'PIT NOW (FUEL CRITICAL)';
    cssClass = 'pit-now';
  } else if (lapsUntilOptimal <= 0) {
    state = 'PIT NOW';
    cssClass = 'pit-now';
  } else if (lapsUntilOptimal <= 2) {
    state = 'PIT WINDOW';
    cssClass = 'pit-warning';
  } else {
    state = 'STAY OUT';
    cssClass = 'stay-out';
  }
  
  // Propagate confidence
  const currConf = getCompoundConfidence(compound);
  const nextConf = getCompoundConfidence(nextCompound);
  
  let strategyConfidence = 'HIGH';
  let confNote = 'Trusted degradation fits used.';
  if (!currConf.trusted || !nextConf.trusted) {
    strategyConfidence = 'LOW';
    confNote = 'Indicative only (weak fits used).';
    if (!currConf.trusted) confNote += ` ${compound}: ${currConf.note}`;
    if (!nextConf.trusted) confNote += ` ${nextCompound}: ${nextConf.note}`;
  }

  return { state, cssClass, optimalLap, strategyConfidence, confNote, nextCompound, fuelNeeded: fuelNeededIfPitNow };
}

export function getTotalLaps() {
  return modelData?.race_info?.laps || 62;
}

export function getCompounds() {
  if (modelData?.compounds) return Object.keys(modelData.compounds);
  return ['SOFT', 'MEDIUM', 'HARD'];
}

/**
 * Get fuel remaining at a given race lap.
 */
export function getFuelRemaining(raceLap) {
  if (!modelData?.fuel) {
    return Math.max(5, 110 - raceLap * 1.77);
  }
  const { max_fuel_kg, burn_rate_kg_per_lap } = modelData.fuel;
  return Math.max(5, max_fuel_kg - raceLap * burn_rate_kg_per_lap);
}
