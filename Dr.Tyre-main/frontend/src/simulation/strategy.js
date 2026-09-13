/**
 * strategy.js — Pit Recommendation Engine
 * 
 * Driven by real fitted degradation curves from the pipeline.
 * Computes deterministic optimal pit laps and undercut viability.
 */
import { raceSetup } from '../setup/setup.js';
import { raceConfig } from './simulation.js';
import { CIRCUITS } from './circuits.js';
import { calculateRegulationTransferFactor } from './regulationTransfer.js';
import { calculatePredictionConfidence } from './predictionConfidence.js';

// ── Strategy Constants ───────────────────────────────────────────
export const PIT_LANE_LOSS = 22.0; // Seconds lost driving through pit lane at speed limit
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

export function getFuelBurnRate(setup = null) {
  let baseRate = modelData?.fuel?.burn_rate_kg_per_lap || 1.6; // kg per lap (calibrated for Singapore, 4.940km)
  
  // Scale by circuit length — shorter laps burn less fuel per lap
  // Reference: Singapore = 4.940 km
  const REFERENCE_LENGTH_KM = 4.940;
  if (raceConfig && raceConfig.trackId && CIRCUITS[raceConfig.trackId]) {
    const circuitLength = CIRCUITS[raceConfig.trackId].lengthKm;
    baseRate *= (circuitLength / REFERENCE_LENGTH_KM);
  }
  
  if (setup && setup.energy && setup.energy.deploymentStrategy) {
    if (setup.energy.deploymentStrategy === 'AGGRESSIVE') {
      baseRate *= 1.15; // 15% more fuel burn
    } else if (setup.energy.deploymentStrategy === 'CONSERVATIVE') {
      baseRate *= 0.85; // 15% less fuel burn
    }
  }
  
  return baseRate;
}

export function calculateOptimalRefuelAmount(lapsRemaining) {
  // Refueling was banned in F1 in 2010. Cars must complete the race on their starting fuel.
  // Returning 0 ensures cars don't suddenly gain 100kg of weight after a pit stop,
  // which was incorrectly negating the fresh tyre pace advantage.
  return 0;
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

export function getSimulationLapStress(setup, thermalZ = 0.0, aeroInterference = 0.0) {
  if (!setup && !thermalZ && !aeroInterference) return 0.0;
  
  // Encode variables to [-1.0, 1.0]
  const df = setup ? ((setup.downforceLevel === 'HIGH') ? 1.0 : (setup.downforceLevel === 'LOW' ? -1.0 : 0.0)) : 0.0;
  // 'balance' in UI is aero balance, 'mechanicalBalance' is mech
  const ab = setup ? ((setup.balance === 'FRONT') ? 1.0 : (setup.balance === 'REAR' ? -1.0 : 0.0)) : 0.0;
  const mb = setup ? ((setup.mechanicalBalance === 'FRONT') ? 1.0 : (setup.mechanicalBalance === 'REAR' ? -1.0 : 0.0)) : 0.0;
  const bb = setup ? ((setup.brakeBias === 'FRONT') ? 1.0 : (setup.brakeBias === 'REAR' ? -1.0 : 0.0)) : 0.0;
  // setup.energy is the energy strategy object
  const edStr = setup?.energy?.deploymentStrategy || 'BALANCED';
  const ed = (edStr === 'AGGRESSIVE') ? 1.0 : (edStr === 'CONSERVATIVE' ? -1.0 : 0.0);
  
  // Calibrated Standard Deviation mapping (physics-informed)
  // Dirty air reduces downforce efficiency, adding a small multiplier to tyre scrub/braking workload
  const trafficStressMultiplier = 1.0 + 0.05 * (aeroInterference || 0.0);
  const deltaBrakingZ = (0.5 * Math.abs(bb) + 0.2 * df) * trafficStressMultiplier;
  const deltaLongitudinalZ = 0.8 * ed - 0.2 * df;
  const deltaCorneringZ = (0.6 * df + 0.3 * Math.abs(ab) + 0.3 * Math.abs(mb)) * trafficStressMultiplier;
  const deltaSpeedZ = -0.5 * df;
  
  // Thermal variable: sustained high speed without cooldown & aggressive power deployment
  const deltaThermalZ = (0.7 * ed + 0.3 * df) + (thermalZ || 0.0);

  // 5-component calibrated weights summing to 1.00 (matching python pipeline)
  const wB = 0.30, wL = 0.20, wC = 0.25, wS = 0.10, wT = 0.15;
  
  return (wB * deltaBrakingZ) + (wL * deltaLongitudinalZ) + (wC * deltaCorneringZ) + (wS * deltaSpeedZ) + (wT * deltaThermalZ);
}

export const COMPOUND_THERMAL_WINDOWS = {
  SOFT:   { opt: 95,  blister: 106 },
  MEDIUM: { opt: 100, blister: 112 },
  HARD:   { opt: 105, blister: 116 }
};

/**
 * Physically progressive temperature-response model.
 * If ΔT <= 0: thermalPenalty = 0
 * If ΔT > 0:  thermalPenalty = K_thermal * (ΔT / T_scale)^p * AgeFactor * OverheatFactor * BlisterFactor
 */
export function calculateThermalPenalty(compound, tyreAge, tyreTemp) {
  const window = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const T_opt = window.opt;
  const T_blister = window.blister;
  const deltaT = tyreTemp - T_opt;

  if (deltaT <= 0) {
    return {
      thermalPenalty: 0,
      deltaT: 0,
      overheatFactor: 1.0,
      blisterFactor: 1.0,
      baseThermalPenalty: 0
    };
  }

  const K_thermal = 0.08; // seconds/lap
  const T_scale = 10.0;   // 10°C
  const p = 1.6;
  const ageFactor = 1 + 0.03 * tyreAge;
  const overheatFactor = 1 + Math.max(0, deltaT - 8.0) / 6.0;

  const baseThermalPenalty = K_thermal * Math.pow(deltaT / T_scale, p) * ageFactor * overheatFactor;

  let blisterFactor = 1.0;
  if (tyreTemp > T_blister) {
    blisterFactor = 1.0 + 2.5 * Math.pow((tyreTemp - T_blister) / 2.0, 1.6);
  }

  const thermalPenalty = baseThermalPenalty * blisterFactor;

  return {
    thermalPenalty,
    deltaT,
    overheatFactor,
    blisterFactor,
    baseThermalPenalty
  };
}

/**
 * Compute the predicted lap-time delta from tyre degradation.
 * Δt_deg = BaseAgeDegradation × (1 + StressFactor) + ThermalPenalty
 */
export function getDegradationDelta(compound, tyreAge, setup = null, thermalState = null, aeroInterference = 0.0, driverBehaviourModifier = 1.0) {
  let baseAgeDeg = 0;
  let stressCoef = 0.02; // Default fallback
  
  if (!modelData?.compounds?.[compound]) {
    const defaultRates = { SOFT: 0.12, MEDIUM: 0.07, HARD: 0.04 };
    baseAgeDeg = (defaultRates[compound] || 0.07) * tyreAge;
  } else {
    const c = modelData.compounds[compound];
    stressCoef = c.stress_coef || 0.02;
    
    // Check if quadratic curve has an inverted vertex (β₂ < 0)
    if (c.deg_quadratic < 0) {
      const vertexAge = -c.deg_linear / (2 * c.deg_quadratic);
      if (tyreAge > vertexAge) {
        const peakDeg = c.deg_linear * vertexAge + c.deg_quadratic * vertexAge * vertexAge;
        const pastVertexLaps = tyreAge - vertexAge;
        baseAgeDeg = peakDeg + pastVertexLaps * 0.1;
      } else {
        baseAgeDeg = c.deg_linear * tyreAge + c.deg_quadratic * tyreAge * tyreAge;
      }
    } else {
      baseAgeDeg = c.deg_linear * tyreAge + c.deg_quadratic * tyreAge * tyreAge;
    }
  }
  
  // Smooth progressive thermal penalty calculation
  const optT = COMPOUND_THERMAL_WINDOWS[compound]?.opt || 100;
  const currentT = thermalState?.tyreTemp !== undefined ? thermalState.tyreTemp : optT;
  const { thermalPenalty, deltaT } = calculateThermalPenalty(compound, tyreAge, currentT);

  // Lap stress uses thermalZ to represent the thermal workload of the lap, plus aerodynamic interference
  const thermalZ = deltaT > 0 ? (deltaT / 12.0) : 0.0;
  const simulationLapStress = getSimulationLapStress(setup, thermalZ, aeroInterference);
  
  // StressFactor modifies BaseAgeDegradation (bounded by driver behaviour modifier, 0.98 - 1.08)
  const boundedModifier = Math.max(0.98, Math.min(1.08, driverBehaviourModifier || 1.0));
  const stressFactor = stressCoef * simulationLapStress * boundedModifier;
  
  // 2024 stress-adjusted baseline
  const stressAdjusted = baseAgeDeg * (1 + stressFactor);

  // ── 2026 REGULATION TRANSFER LAYER ──
  // Adjusts the 2024-trained LME baseline for the 2026 vehicle regulations.
  // R_2026 = f(mass, tyre width, aero, traction, sliding)
  // See regulationTransfer.js for full physics documentation.
  const regResult = calculateRegulationTransferFactor(setup, simulationLapStress, aeroInterference, compound);
  const regulated = stressAdjusted * regResult.factor;

  // Final Degradation Formula:
  // Δt_deg = (BaseAgeDegradation × (1 + StressFactor) × R_2026) + ThermalPenalty
  // Scaled down by 35% to prevent overly aggressive pace drop-offs
  let delta = (regulated + thermalPenalty) * 0.65;
  
  let trackMultiplier = 1.0;
  if (raceConfig && raceConfig.trackId) {
    if (raceConfig.trackId === 'monza') trackMultiplier = 0.7;
    if (raceConfig.trackId === 'singapore') trackMultiplier = 1.3;
    if (raceConfig.trackId === 'monaco') trackMultiplier = 0.5;
  }
  
  return Math.max(0, delta) * weatherMultiplier * trackMultiplier;
}

/**
 * Compute the +/- uncertainty band for the degradation delta based on the LME Confidence Intervals.
 */
export function getDegradationUncertainty(compound, tyreAge, setup = null) {
  if (!modelData?.compounds?.[compound] || !modelData.compounds[compound].deg_linear_ci) {
    return 0.0;
  }
  
  const c = modelData.compounds[compound];
  // Calculate upper bound delta from the 95% CI
  const upperSlope = c.deg_linear_ci[1];
  const meanSlope = c.deg_linear;
  
  let deltaCI = (upperSlope - meanSlope) * tyreAge;
  
  const stressCoef = c.stress_coef || 0.02;
  const simulationLapStress = getSimulationLapStress(setup);
  const setupDependentStressEffect = stressCoef * simulationLapStress * tyreAge;
  
  deltaCI += Math.abs(setupDependentStressEffect * 0.2); // Rough 20% uncertainty added for extreme setups
  
  // Apply 2026 Regulation Transfer to scale uncertainty band consistently
  const regResult = calculateRegulationTransferFactor(setup, simulationLapStress, 0.0, compound);
  deltaCI *= regResult.factor;
  
  let trackMultiplier = 1.0;
  if (raceConfig && raceConfig.trackId) {
    if (raceConfig.trackId === 'monza') trackMultiplier = 0.7;
    if (raceConfig.trackId === 'singapore') trackMultiplier = 1.3;
    if (raceConfig.trackId === 'monaco') trackMultiplier = 0.5;
  }
  
  return Math.max(0, deltaCI) * weatherMultiplier * trackMultiplier;
}

/**
 * Compute the marginal degradation rate at current tyre age.
 * This is the derivative: dΔ/d(age) = β₁ + 2β₂ × age
 */
export function getMarginalDegRate(compound, tyreAge, setup = null) {
  let rate = 0;
  let stressCoef = 0.02;
  
  if (!modelData?.compounds?.[compound]) {
    const rates = { SOFT: 0.12, MEDIUM: 0.07, HARD: 0.04 };
    rate = rates[compound] || 0.07;
  } else {
    const c = modelData.compounds[compound];
    stressCoef = c.stress_coef || 0.02;
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
  
  const simulationLapStress = getSimulationLapStress(setup);
  const setupMarginalEffect = stressCoef * simulationLapStress; 
  rate += setupMarginalEffect;
  
  // Apply 2026 Regulation Transfer to marginal rate for consistent strategy slopes
  const regResult = calculateRegulationTransferFactor(setup, simulationLapStress, 0.0, compound);
  rate *= regResult.factor;
  
  let trackMultiplier = 1.0;
  if (raceConfig && raceConfig.trackId) {
    if (raceConfig.trackId === 'monza') trackMultiplier = 0.7;
    if (raceConfig.trackId === 'singapore') trackMultiplier = 1.3;
    if (raceConfig.trackId === 'monaco') trackMultiplier = 0.5;
  }
  
  return Math.max(0, rate) * weatherMultiplier * trackMultiplier;
}

export function getCompoundBasePace(compound) {
  if (!modelData?.compounds?.[compound]) {
    const defaultPace = { SOFT: 90.0, MEDIUM: 91.0, HARD: 92.0 };
    return defaultPace[compound] || 91.0;
  }
  return modelData.compounds[compound].fresh_pace;
}

// ── Strategy Hysteresis Cache ──
let lastStrategyEval = {
    lap: -1,
    optimalLap: -1,
    minTotalTime: Infinity,
    evalTime: 0
};
const HYSTERESIS_THRESHOLD_SEC = 1.5;

export const GP_CLIFF_THRESHOLDS = {
  SOFT: 18,
  MEDIUM: 24,
  HARD: 48
};

/**
 * Get compound cliff lap with GP baseline fallback.
 * FP2 practice runs are too short (< 15 laps) and raw polynomial fitting can produce artifact cliffs.
 */
export function getCompoundCliffLap(compound) {
  const c = modelData?.compounds?.[compound];
  if (c && typeof c.cliff_lap === 'number' && c.cliff_lap >= 15) {
    return c.cliff_lap;
  }
  return GP_CLIFF_THRESHOLDS[compound] || 30;
}

export function simulate_stint_time(candidateLap, currentCompound, currentTyreAge, currentRaceLap, freshCompound, setup = null, allCars = null, currentFuelKg = 110, thermalState = null) {
  const totalLaps = getTotalLaps();
  const lapsOnCurrent = candidateLap - currentRaceLap;
  const lapsOnFresh = totalLaps - candidateLap;

  let totalTime = 0;
  const currentBasePace = getCompoundBasePace(currentCompound);
  const freshBasePace = getCompoundBasePace(freshCompound);
  
  // Environmental factors
  const trackEvoSlope = modelData?.track_evolution?.slope_s_per_lap || 0;
  const currentCliffLap = getCompoundCliffLap(currentCompound);
  const freshCliffLap = getCompoundCliffLap(freshCompound);
  const burnRate = getFuelBurnRate(setup);
  const fuelWeightEffectPerKg = 0.035; // approx 0.035s per kg

  // 1. Simulate remaining laps on current tyre with progressive thermal evolution
  let currentFuelRemainingKg = currentFuelKg;
  const currentOptTemp = COMPOUND_THERMAL_WINDOWS[currentCompound]?.opt || 100;
  const instantTemp = thermalState?.tyreTemp !== undefined ? thermalState.tyreTemp : currentOptTemp;
  // Damped base temperature for future macro-stint projection: prevents instantaneous cornering spikes from corrupting 30-lap projections
  const currentInitialTemp = currentOptTemp + 0.3 * (instantTemp - currentOptTemp);

  const currentBlisterTemp = COMPOUND_THERMAL_WINDOWS[currentCompound]?.blister || 112;

  for (let i = 0; i < lapsOnCurrent; i++) {
    let age = currentTyreAge + i;
    // Tyre temperature naturally creeps upwards under sustained stint wear
    const projectedTemp = currentInitialTemp + i * 0.35;
    const lapThermal = { tyreTemp: projectedTemp };
    let lapPace = currentBasePace + getDegradationDelta(currentCompound, age, setup, lapThermal);
    
    // Dynamic Cliff Penalty
    if (currentCliffLap && age >= currentCliffLap) {
      lapPace += 2.5 * (age - currentCliffLap + 1); // Progressive penalty
    }

    // Dynamic Blistering Penalty for continuing to push on overheated carcass
    if (projectedTemp > currentBlisterTemp) {
      lapPace += 2.0 * Math.pow(projectedTemp - currentBlisterTemp, 1.4);
    }
    
    // Track Evolution
    lapPace += (currentRaceLap + i) * trackEvoSlope;
    
    // Fuel Weight Decay
    const fuelEffect = currentFuelRemainingKg * fuelWeightEffectPerKg;
    lapPace += fuelEffect;
    currentFuelRemainingKg -= burnRate;
    
    totalTime += lapPace;
  }

  // 2. Simulate pit stop and fresh tyre stint
  if (lapsOnFresh > 0) {
    const fuelNeeded = calculateOptimalRefuelAmount(lapsOnFresh);
    const pitCost = getEffectivePitCost(fuelNeeded) + OUT_LAP_COLD_TYRE_PENALTY;
    
    // Dynamic Traffic Penalty at Rejoin:
    // Only apply discrete car-by-car traffic collisions in the immediate tactical window (<= 3 laps).
    // For distant candidate laps (e.g. 15-30 laps ahead), linear progress projection creates noisy spikes that destabilize optimal lap.
    let trafficPenalty = 0;
    if (allCars && (candidateLap - currentRaceLap <= 3)) { 
        const pitExitProgress = 0.03; // Approximate pit exit point
        let timeToPitEntry = 0;
        let currentFuelRem = currentFuelKg;
        for (let i = 0; i < lapsOnCurrent; i++) {
            let age = currentTyreAge + i;
            const projectedTemp = currentInitialTemp + i * 0.35;
            const lapThermal = { tyreTemp: projectedTemp };
            let lapPace = currentBasePace + getDegradationDelta(currentCompound, age, setup, lapThermal) + (currentRaceLap + i) * trackEvoSlope + currentFuelRem * fuelWeightEffectPerKg;
            if (currentCliffLap && age >= currentCliffLap) lapPace += 2.5 * (age - currentCliffLap + 1);
            if (projectedTemp > currentBlisterTemp) {
                lapPace += 2.0 * Math.pow(projectedTemp - currentBlisterTemp, 1.4);
            }
            timeToPitEntry += lapPace;
            currentFuelRem -= burnRate;
        }

        allCars.forEach(car => {
            if (!car.isUser) {
                const carLapTime = car.baseLapTime + getDegradationDelta(car.compound, car.tyreAge, car.setup, car.thermalState, car.aeroInterference || 0);
                const futureCarProgress = car.progress + ((timeToPitEntry + pitCost) / carLapTime);
                const wrappedFutureProgress = ((futureCarProgress % 1.0) + 1.0) % 1.0;
                
                const diff = Math.min(Math.abs(wrappedFutureProgress - pitExitProgress), 1.0 - Math.abs(wrappedFutureProgress - pitExitProgress));
                const gapSec = diff * carLapTime;
                if (gapSec < 3.0) {
                    const x = Math.min(1.0, Math.max(0, (3.0 - gapSec) / (3.0 - 0.8)));
                    const aeroWake = x * x * (3 - 2 * x);
                    trafficPenalty += aeroWake * 1.5;
                }
            }
        });
        trafficPenalty = Math.min(trafficPenalty, 3.5);
    }
    
    totalTime += pitCost + trafficPenalty;
    
    let freshFuelRemainingKg = currentFuelKg - (lapsOnCurrent * burnRate) + fuelNeeded;
    const freshOptTemp = COMPOUND_THERMAL_WINDOWS[freshCompound]?.opt || 100;
    for (let i = 1; i <= lapsOnFresh; i++) {
      const freshProjectedTemp = freshOptTemp + (i - 1) * 0.25;
      const freshThermal = { tyreTemp: freshProjectedTemp };
      let lapPace = freshBasePace + getDegradationDelta(freshCompound, i, setup, freshThermal);
      
      if (freshCliffLap && i >= freshCliffLap) {
        lapPace += 2.5 * (i - freshCliffLap + 1);
      }
      
      lapPace += (candidateLap + i) * trackEvoSlope;
      
      const fuelEffect = freshFuelRemainingKg * fuelWeightEffectPerKg;
      lapPace += fuelEffect;
      freshFuelRemainingKg -= burnRate;
      
      totalTime += lapPace;
    }
  }
  return totalTime;
}

export const MIN_STINT_LAPS = 3;

/**
 * Check if a fresh compound can realistically complete the remaining laps in a 1-stop strategy
 * without hitting an extreme cliff failure (e.g. Soft cannot do 50 laps).
 */
export function isCompoundViableForRemainingLaps(targetCompound, lapsToFinish) {
  if (lapsToFinish <= 0) return true;
  const cliff = getCompoundCliffLap(targetCompound);
  // A fresh tyre in a 1-stop projection can finish if lapsToFinish <= 1.25x its cliff threshold
  return lapsToFinish <= Math.round(cliff * 1.25);
}

// ── Tracked Optimal Stop Lap for Stability Filter ──
let trackedOptimalLap = null;
let lastTrackedCompound = null;

export function resetOptimalTracking() {
  trackedOptimalLap = null;
  lastTrackedCompound = null;
}

/**
 * Find the optimal stop lap over the remaining race distance by exhaustive search.
 * Goal: minimize total time = (current tyre time) + pit_cost + (fresh tyre time)
 */
export function optimal_stop_lap(currentCompound, currentTyreAge, currentRaceLap, freshCompound, currentFuelKg, setup = null, allCars = null, thermalState = null) {
  const burnRate = getFuelBurnRate(setup);
  const currentFuelLaps = currentFuelKg / burnRate;
  
  if (currentFuelLaps < 1.0) {
    if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
      return { optimalLap: -1, minTotalTime: Infinity }; // DNF
    }
    return { optimalLap: currentRaceLap, minTotalTime: 0 }; // Force pit NOW
  }
  
  const totalLaps = getTotalLaps();
  const maxLapsOnCurrentFuel = Math.floor(currentFuelKg / burnRate);

  // Minimum stint constraint: A tyre stint must have at least MIN_STINT_LAPS completed
  // before a normal pit stop can be scheduled (opening-lap protection).
  const minStopLap = (currentTyreAge < MIN_STINT_LAPS)
    ? Math.min(totalLaps, currentRaceLap + (MIN_STINT_LAPS - currentTyreAge))
    : currentRaceLap;

  // Upper bound: mandatory stop in 1-stop race must occur before the final laps
  const maxStopLap = Math.max(minStopLap, totalLaps - 3);

  let bestLap = minStopLap;
  let minTotalTime = Infinity;

  // Search candidate stop laps
  for (let candidateLap = minStopLap; candidateLap <= maxStopLap; candidateLap++) {
    const lapsOnCurrent = candidateLap - currentRaceLap;
    if (lapsOnCurrent > maxLapsOnCurrentFuel) continue;

    const lapsOnFresh = totalLaps - candidateLap;
    if (!isCompoundViableForRemainingLaps(freshCompound, lapsOnFresh)) continue;

    const totalDelta = simulate_stint_time(candidateLap, currentCompound, currentTyreAge, currentRaceLap, freshCompound, setup, allCars, currentFuelKg, thermalState);

    if (totalDelta < minTotalTime) {
      minTotalTime = totalDelta;
      bestLap = candidateLap;
    }
  }

  // ── Stability Damping Filter ──
  // Prevents optimal lap from jumping by 10-15 laps on consecutive frames.
  // Changes are bounded to at most +/- 1 lap per update unless an urgent event occurs.
  if (trackedOptimalLap === null || lastTrackedCompound !== currentCompound || currentRaceLap <= 2) {
    trackedOptimalLap = bestLap;
    lastTrackedCompound = currentCompound;
  } else {
    const diff = bestLap - trackedOptimalLap;
    if (diff > 1) {
      trackedOptimalLap += 1;
    } else if (diff < -1) {
      trackedOptimalLap -= 1;
    } else {
      trackedOptimalLap = bestLap;
    }
  }

  // Ensure optimal lap is at least currentRaceLap and does not exceed maxStopLap
  trackedOptimalLap = Math.min(maxStopLap, Math.max(currentRaceLap, trackedOptimalLap));
  
  return { optimalLap: trackedOptimalLap, minTotalTime };
}


/**
 * Evaluate if an undercut against a rival works.
 * 
 * Returns { works: boolean, net_gain_seconds: number }
 */
export function evaluate_undercut(rivalCompound, rivalTyreAge, gapToRival, lapsRemaining, freshCompound, rivalSetup = null, ourSetup = null, customRivalPace = null, customOurPace = null) {
  const avgRefuel = calculateOptimalRefuelAmount(lapsRemaining);
  const pitCost = getEffectivePitCost(avgRefuel) + OUT_LAP_COLD_TYRE_PENALTY;
  
  const rivalBasePace = customRivalPace !== null ? customRivalPace : getCompoundBasePace(rivalCompound);
  const ourBasePace = customOurPace !== null ? customOurPace : getCompoundBasePace(freshCompound);
  const freshBasePaceForRival = getCompoundBasePace(freshCompound);
  
  const rivalLap1 = rivalBasePace + getDegradationDelta(rivalCompound, rivalTyreAge, rivalSetup);
  const rivalLap2 = pitCost + freshBasePaceForRival + getDegradationDelta(freshCompound, 1, rivalSetup);
  const rivalTotal = rivalLap1 + rivalLap2;
  
  const ourLap1 = pitCost + ourBasePace + getDegradationDelta(freshCompound, 1, ourSetup);
  const ourLap2 = ourBasePace + getDegradationDelta(freshCompound, 2, ourSetup);
  const ourTotal = ourLap1 + ourLap2;
  
  const deltaGain = rivalTotal - ourTotal;
  const works = deltaGain > gapToRival;
  return { works, net_gain_seconds: deltaGain };
}

/**
 * Get pit recommendation state driven by actual strategy optimal lap and fuel.
 */
// ── Hysteresis State for Prescription Engine ──
let lastPrescriptionState = {
  lap: -1,
  action: 'STAY OUT',
  bestTotalTime: Infinity,
  timestamp: 0
};
const PRESCRIPTION_HYSTERESIS_THRESHOLD = 1.2; // seconds

/**
 * Evaluate projected competitor traffic risk at pit exit.
 * Returns { risk: 'LOW'|'MEDIUM'|'HIGH', details: string, minGapSec: number, nearbyCarsCount: number }
 */
export function evaluatePitExitTraffic(currentRaceLap, lapsOnCurrent, currentFuelKg, setup, allCars, targetPitLap = null) {
  if (!allCars || allCars.length <= 1) {
    return { risk: 'LOW', details: 'Clear pit exit (clear air)', minGapSec: 99.0, nearbyCarsCount: 0 };
  }
  const totalLaps = getTotalLaps();
  const lapsRemaining = Math.max(1, totalLaps - currentRaceLap);
  const pitCost = getEffectivePitCost(calculateOptimalRefuelAmount(lapsRemaining)) + OUT_LAP_COLD_TYRE_PENALTY;
  const pitExitProgress = 0.03; 
  const currentBasePace = getCompoundBasePace('MEDIUM');
  const trackEvoSlope = modelData?.track_evolution?.slope_s_per_lap || 0;
  const burnRate = getFuelBurnRate(setup);
  const fuelWeightEffectPerKg = 0.035;

  // Approximate time until reaching pit entry
  let timeToPitEntry = 0;
  let currentFuelRem = currentFuelKg;
  for (let i = 0; i < lapsOnCurrent; i++) {
    let lapPace = currentBasePace + (currentRaceLap + i) * trackEvoSlope + currentFuelRem * fuelWeightEffectPerKg;
    timeToPitEntry += lapPace;
    currentFuelRem -= burnRate;
  }

  let nearbyCarsCount = 0;
  let minGapSec = 999;
  let closestCar = null;

  allCars.forEach(car => {
    if (!car.isUser) {
      const carLapTime = car.baseLapTime + getDegradationDelta(car.compound, car.tyreAge, car.setup, car.thermalState);
      const futureCarProgress = car.progress + ((timeToPitEntry + pitCost) / carLapTime);
      const wrappedFuture = ((futureCarProgress % 1.0) + 1.0) % 1.0;
      const diff = Math.min(Math.abs(wrappedFuture - pitExitProgress), 1.0 - Math.abs(wrappedFuture - pitExitProgress));
      const gapSec = diff * carLapTime;
      if (gapSec < minGapSec) {
        minGapSec = gapSec;
        closestCar = car;
      }
      if (diff < 0.035) { // within ~3.2 seconds
        nearbyCarsCount++;
      }
    }
  });

  let risk = 'LOW';
  let details = 'Clear pit exit window';
  if (nearbyCarsCount >= 2 || minGapSec < 1.2) {
    risk = 'HIGH';
    details = `Heavy traffic train near exit (P${closestCar?.position || '?'} #${closestCar?.number || '?'}, ${minGapSec.toFixed(1)}s)`;
  } else if (nearbyCarsCount === 1 || minGapSec < 2.8) {
    risk = 'MEDIUM';
    details = `Exposed to car P${closestCar?.position || '?'} #${closestCar?.number || '?'} (${minGapSec.toFixed(1)}s gap)`;
  } else {
    risk = 'LOW';
    details = `Clear rejoin window (+${minGapSec.toFixed(1)}s gap to nearest car)`;
  }

  return { risk, details, minGapSec, nearbyCarsCount };
}

/**
 * PRESCRIPTION ENGINE
 * "What should the team do next?"
 * Evaluates live candidates deterministically using simulate_stint_time() and ranks them.
 */
export function getPrescription(compound, tyreAge, currentLap, fuelPct, setup = null, allCars = null, thermalState = null, pitStops = 0, driverBehaviour = null, tyreRecovery = null, opportunityReport = null) {
  const totalLaps = getTotalLaps();
  const lapsRemaining = Math.max(0, totalLaps - currentLap);
  // Robust fuel normalization: handles both 0-100 percentage and 0.0-1.0 fraction
  let normalizedFuelPct = (fuelPct !== undefined && fuelPct !== null) ? Number(fuelPct) : 100;
  if (normalizedFuelPct > 0 && normalizedFuelPct <= 1.0) {
    normalizedFuelPct *= 100;
  }
  const fuelKg = (normalizedFuelPct / 100) * 110; // Standard 110kg F1 fuel cell
  const burnRate = getFuelBurnRate(setup);
  const fuelLaps = fuelKg / burnRate;
  const cInfo = getCompoundConfidence(compound);

  // Compound thermal evaluation
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const currentT = thermalState?.tyreTemp !== undefined ? thermalState.tyreTemp : win.opt;
  const deltaT = currentT - win.opt;
  let tyreTemperature = 'OPTIMAL';
  if (currentT > win.blister) tyreTemperature = 'BLISTERING';
  else if (deltaT > 10.0) tyreTemperature = 'HOT';
  else if (deltaT > 4.0) tyreTemperature = 'WARM';
  else tyreTemperature = 'OPTIMAL';

  const thermalRes = calculateThermalPenalty(compound, tyreAge, currentT);
  const thermalPenaltySec = thermalRes.thermalPenalty;

  // 1. Critical Fuel Overrides
  if (fuelLaps < 1.0 && lapsRemaining > 0) {
    if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
      return {
        action: 'FUEL CRITICAL',
        recommendedAction: 'Conserve fuel immediately to attempt finish',
        targetCompound: compound,
        lapsUntilAction: 0,
        reason: 'The car has insufficient fuel remaining and in-race refuelling is prohibited.',
        projectedGain: 0.0,
        trafficRisk: 'LOW',
        trafficDetails: 'N/A',
        tyreTemperature,
        tyreTempC: Math.round(currentT),
        tyreAge,
        projectedDegradation: getDegradationDelta(compound, tyreAge, setup, thermalState),
        pitLoss: getEffectivePitCost(),
        nextDecisionLap: currentLap + 1,
        confidence: 'HIGH',
        confidenceScore: 95,
        confidenceLevel: 'HIGH',
        confidenceUncertainty: 0.015,
        confidenceReasons: ['Fuel reserve critical (< 1.0 lap remaining); in-race refuelling prohibited.'],
        state: 'FUEL CRITICAL',
        optimalLap: '-',
        nextCompound: '-',
        reasoning: 'The car has insufficient fuel remaining and in-race refuelling is prohibited.',
        candidates: []
      };
    }
    return {
      action: 'PIT NOW',
      recommendedAction: 'Box this lap immediately for mandatory refuelling',
      targetCompound: (compound === 'HARD') ? 'MEDIUM' : 'HARD',
      lapsUntilAction: 0,
      reason: `Fuel reserves critically low (${fuelKg.toFixed(1)}kg, ${fuelLaps.toFixed(1)} laps remaining).`,
      projectedGain: 99.0,
      trafficRisk: 'LOW',
      trafficDetails: 'Priority box for fuel',
      tyreTemperature,
      tyreTempC: Math.round(currentT),
      tyreAge,
      projectedDegradation: getDegradationDelta(compound, tyreAge, setup, thermalState),
      pitLoss: getEffectivePitCost(),
      nextDecisionLap: currentLap + 1,
      confidence: 'HIGH',
      confidenceScore: 98,
      confidenceLevel: 'HIGH',
      confidenceUncertainty: 0.015,
      confidenceReasons: ['Fuel reserve reaches critical limit (< 1 lap); mandatory box required.'],
      state: 'PIT NOW (FUEL)',
      optimalLap: currentLap,
      nextCompound: (compound === 'HARD') ? 'MEDIUM' : 'HARD',
      reasoning: 'Immediate pit stop required to refuel before flame-out.',
      fuelNeeded: calculateOptimalRefuelAmount(lapsRemaining),
      candidates: []
    };
  }

  // 2. Mandatory Pit Stop Completed Check
  // In a 2-stop strategy, allow second pit evaluation; only lock STAY OUT after 2 stops
  if (pitStops >= 2 && isCompoundViableForRemainingLaps(compound, lapsRemaining) && tyreTemperature !== 'BLISTERING') {
    const currentPaceLoss = getDegradationDelta(compound, tyreAge, setup, thermalState);
    const degUncert = getDegradationUncertainty(compound, tyreAge, setup);
    return {
      action: 'STAY OUT',
      recommendedAction: `Continue on ${compound} to race finish (Stint 2)`,
      targetCompound: compound,
      lapsUntilAction: lapsRemaining,
      reason: `Mandatory pit stop fulfilled. Current ${compound} tyres (Age ${tyreAge}) are within degradation limits to reach the chequered flag on Lap ${totalLaps}.`,
      projectedGain: null,
      trafficRisk: 'LOW',
      trafficDetails: 'Running to chequered flag',
      tyreTemperature,
      tyreTempC: Math.round(currentT),
      tyreAge,
      projectedDegradation: currentPaceLoss,
      pitLoss: getEffectivePitCost(),
      optimalLap: 'RACE FINISH',
      nextDecisionLap: 'MONITOR WEAR',
      confidence: 'HIGH',
      confidenceScore: 92,
      confidenceLevel: 'HIGH',
      confidenceUncertainty: degUncert,
      confidenceReasons: ['Mandatory pit stop fulfilled; tyre life within safe degradation limits to finish.'],
      candidates: [
        {
          id: 'STAY_OUT_FINISH',
          action: 'STAY OUT',
          stopLap: totalLaps,
          targetCompound: compound,
          totalTime: 0,
          deltaBest: 0,
          rank: 1,
          trafficRisk: 'LOW',
          trafficDetails: 'Final stint',
          description: `Manage ${compound} tyres to chequered flag`
        }
      ],
      alternative: null,
      state: 'STAY OUT',
      cssClass: 'stay-out',
      nextCompound: compound,
      strategyConfidence: 'HIGH',
      confNote: 'Final stint tyre management',
      reasoning: 'Mandatory pit stop fulfilled. Conserve tyres to chequered flag.',
      counterfactualDelta: 0.0,
      fuelNeeded: 0
    };
  }

  // Target tyre choices
  const primaryTargetCompound = (compound === 'HARD') ? 'MEDIUM' : 'HARD';
  const secondaryTargetCompound = (compound === 'SOFT') ? 'HARD' : 'SOFT';

  const cliffLap = getCompoundCliffLap(compound);
  const isCliffReached = cliffLap && tyreAge >= cliffLap;
  const isCliffApproaching = cliffLap && (cliffLap - tyreAge <= 3) && (cliffLap - tyreAge > 0);

  // Evaluate Pit Exit Traffic at this moment
  const trafficNow = evaluatePitExitTraffic(currentLap, 0, fuelKg, setup, allCars, currentLap);
  const trafficNext = evaluatePitExitTraffic(currentLap, 1, fuelKg, setup, allCars, currentLap + 1);

  // Exhaustive optimal lap calculation with opening-lap protection
  const optResult = optimal_stop_lap(compound, tyreAge, currentLap, primaryTargetCompound, fuelKg, setup, allCars, thermalState);
  const optimalLap = optResult.optimalLap;

  // 1. Minimum Stint & Opening-Lap Protection Check
  const isOpeningStint = (tyreAge < MIN_STINT_LAPS) || (currentLap <= 2);

  // Always evaluate the baseline STAY OUT strategy across the full remaining race horizon
  const targetStayOutLap = Math.min(totalLaps, Math.max(currentLap + 1, optimalLap));
  const timeStayOut = simulate_stint_time(targetStayOutLap, compound, tyreAge, currentLap, primaryTargetCompound, setup, allCars, fuelKg, thermalState);

  // Maximum physically plausible time delta across remaining race (numerical sanity bound)
  const MAX_STRATEGY_TIME_DELTA = Math.min(600, Math.max(90, lapsRemaining * 10.0));

  const candidates = [];

  // Always include the STAY OUT candidate representing the baseline strategy
  const lapsToWait = Math.max(0, targetStayOutLap - currentLap);
  candidates.push({
    id: 'STAY_OUT_OPTIMAL',
    action: 'STAY OUT',
    stopLap: targetStayOutLap,
    targetCompound: primaryTargetCompound,
    totalTime: timeStayOut,
    trafficRisk: 'LOW',
    trafficDetails: `Target stop scheduled on Lap ${targetStayOutLap} (${primaryTargetCompound})`,
    description: (lapsToWait > 0)
      ? `Continue on ${compound} for ${lapsToWait} laps (Target: Lap ${targetStayOutLap} → ${primaryTargetCompound})`
      : `Continue on ${compound} to race finish`
  });

  // If inside opening stint, normal PIT NOW is strictly ineligible unless an explicit race emergency exists
  if (!isOpeningStint) {
    // Candidate: PIT NOW (Primary target compound)
    if (isCompoundViableForRemainingLaps(primaryTargetCompound, lapsRemaining)) {
      const timePitNowPrimary = simulate_stint_time(currentLap, compound, tyreAge, currentLap, primaryTargetCompound, setup, allCars, fuelKg, thermalState);
      if (Math.abs(timePitNowPrimary - timeStayOut) <= MAX_STRATEGY_TIME_DELTA) {
        candidates.push({
          id: 'PIT_NOW_PRIMARY',
          action: 'PIT NOW',
          stopLap: currentLap,
          targetCompound: primaryTargetCompound,
          totalTime: timePitNowPrimary,
          trafficRisk: trafficNow.risk,
          trafficDetails: trafficNow.details,
          description: `Pit this lap and switch to ${primaryTargetCompound}`
        });
      }
    }

    // Candidate: PIT NOW (Secondary target compound if viable for remaining laps)
    if (secondaryTargetCompound && isCompoundViableForRemainingLaps(secondaryTargetCompound, lapsRemaining)) {
      const timePitNowSec = simulate_stint_time(currentLap, compound, tyreAge, currentLap, secondaryTargetCompound, setup, allCars, fuelKg, thermalState);
      if (Math.abs(timePitNowSec - timeStayOut) <= MAX_STRATEGY_TIME_DELTA) {
        candidates.push({
          id: 'PIT_NOW_SECONDARY',
          action: 'PIT NOW',
          stopLap: currentLap,
          targetCompound: secondaryTargetCompound,
          totalTime: timePitNowSec,
          trafficRisk: trafficNow.risk,
          trafficDetails: trafficNow.details,
          description: `Pit this lap and switch to ${secondaryTargetCompound}`
        });
      }
    }

    // Candidate: PIT WINDOW OPEN
    if (lapsRemaining >= 2 && isCompoundViableForRemainingLaps(primaryTargetCompound, lapsRemaining - 1)) {
      const timePitIn1 = simulate_stint_time(currentLap + 1, compound, tyreAge, currentLap, primaryTargetCompound, setup, allCars, fuelKg, thermalState);
      if (Math.abs(timePitIn1 - timeStayOut) <= MAX_STRATEGY_TIME_DELTA) {
        candidates.push({
          id: 'PIT_IN_1_LAP',
          action: 'PIT WINDOW OPEN',
          stopLap: currentLap + 1,
          targetCompound: primaryTargetCompound,
          totalTime: timePitIn1,
          trafficRisk: trafficNext.risk,
          trafficDetails: trafficNext.details,
          description: `Complete 1 more lap on ${compound}, then box for ${primaryTargetCompound}`
        });
      }
    }

    // Candidate: PIT WINDOW OPEN
    if (lapsRemaining >= 3 && isCompoundViableForRemainingLaps(primaryTargetCompound, lapsRemaining - 2)) {
      const timePitIn2 = simulate_stint_time(currentLap + 2, compound, tyreAge, currentLap, primaryTargetCompound, setup, allCars, fuelKg, thermalState);
      if (Math.abs(timePitIn2 - timeStayOut) <= MAX_STRATEGY_TIME_DELTA) {
        candidates.push({
          id: 'PIT_IN_2_LAPS',
          action: 'PIT WINDOW OPEN',
          stopLap: currentLap + 2,
          targetCompound: primaryTargetCompound,
          totalTime: timePitIn2,
          trafficRisk: 'LOW',
          trafficDetails: 'Projected pit exit window in 2 laps',
          description: `Continue for 2 more laps on ${compound}, then box for ${primaryTargetCompound}`
        });
      }
    }
  }

  // Rank candidates ascending by total projected race time
  candidates.sort((a, b) => a.totalTime - b.totalTime);
  const bestTime = candidates[0]?.totalTime || 0;
  candidates.forEach((c, idx) => {
    c.rank = idx + 1;
    c.deltaBest = Number((c.totalTime - bestTime).toFixed(1));
  });

  let primary = candidates[0];
  let alternative = candidates[1] || candidates[0];

  // If opening stint, force primary to STAY OUT and nullify fake projected gain
  if (isOpeningStint) {
    const stayOutCand = candidates.find(c => c.action === 'STAY OUT') || candidates[0];
    primary = stayOutCand;
    alternative = candidates.find(c => c !== stayOutCand) || null;
  } else {
    // Decisive Pit Window Triggering
    const isAtOrPastOptimalLap = currentLap >= optResult.optimalLap;
    const isUrgentPit = isAtOrPastOptimalLap || isCliffReached || tyreTemperature === 'BLISTERING';

    if (isUrgentPit) {
      const pitNowCand = candidates.find(c => c.action === 'PIT NOW');
      if (pitNowCand) {
        primary = pitNowCand;
        alternative = candidates.find(c => c.action !== 'PIT NOW') || candidates[1] || candidates[0];
      }
    } else if (optResult.optimalLap - currentLap === 1) {
      const pit1Cand = candidates.find(c => c.action === 'PIT WINDOW OPEN');
      if (pit1Cand) {
        primary = pit1Cand;
        alternative = candidates.find(c => c !== pit1Cand) || candidates[0];
      }
    } else if (optResult.optimalLap - currentLap === 2) {
      const pit2Cand = candidates.find(c => c.action === 'PIT WINDOW OPEN');
      if (pit2Cand) {
        primary = pit2Cand;
        alternative = candidates.find(c => c !== pit2Cand) || candidates[0];
      }
    } else {
      const stayOutCand = candidates.find(c => c.action === 'STAY OUT');
      if (stayOutCand && stayOutCand.totalTime <= candidates[0].totalTime + 2.0) {
        primary = stayOutCand;
        alternative = candidates.find(c => c !== stayOutCand) || candidates[0];
      }
    }

    // ── Anti-Oscillation Hysteresis ──
    const isCountdownPit = primary.action === 'PIT WINDOW OPEN' || primary.action === 'PIT WINDOW OPEN';
    if (lastPrescriptionState.action && lastPrescriptionState.action !== primary.action) {
      const timeSaved = alternative ? (alternative.totalTime - primary.totalTime) : 0;
      const isUrgentCondition = isUrgentPit || isCountdownPit || (trafficNow.risk === 'HIGH' && primary.action === 'PIT NOW');
      if (!isUrgentCondition && timeSaved < PRESCRIPTION_HYSTERESIS_THRESHOLD) {
        const prevActionCand = candidates.find(c => c.action === lastPrescriptionState.action);
        if (prevActionCand && (prevActionCand.totalTime - primary.totalTime) < PRESCRIPTION_HYSTERESIS_THRESHOLD) {
          alternative = primary;
          primary = prevActionCand;
        }
      }
    }
  }

  lastPrescriptionState = {
    lap: currentLap,
    action: primary.action,
    bestTotalTime: primary.totalTime,
    timestamp: Date.now()
  };

  // Projected Gain: Exact calculated difference between competing strategies
  let projectedGain = null;
  if (!isOpeningStint && alternative && alternative !== primary) {
    if (primary.action === 'PIT NOW') {
      projectedGain = Math.max(0.1, Number((timeStayOut - primary.totalTime).toFixed(1)));
    } else {
      projectedGain = Math.max(0.1, Number((alternative.totalTime - primary.totalTime).toFixed(1)));
    }
    // Safety check: ensure impossible/divergent numbers are not displayed
    if (projectedGain > MAX_STRATEGY_TIME_DELTA) {
      projectedGain = null;
    }
  }

  // Laps until action
  const lapsUntilAction = Math.max(0, primary.stopLap - currentLap);

  // ── Optimal Pit vs Next Decision Resolution ──
  // 1. OPTIMAL PIT: Optimizer's current calculated best pit lap based on complete race calculation
  let displayedOptimalLap = optResult.optimalLap;
  if (primary.action === 'PIT NOW') {
    displayedOptimalLap = currentLap;
  } else if (primary.action === 'PIT WINDOW OPEN') {
    displayedOptimalLap = currentLap + 1;
  } else if (primary.action === 'PIT WINDOW OPEN') {
    displayedOptimalLap = currentLap + 2;
  } else {
    displayedOptimalLap = Math.max(currentLap + 1, optResult.optimalLap);
  }

  // 2. NEXT DECISION: When the strategy engine will re-evaluate the situation
  let nextDecisionLap = '';
  if (isOpeningStint) {
    nextDecisionLap = `RE-EVALUATE LAP ${MIN_STINT_LAPS + 1}`;
  } else if (primary.action === 'PIT NOW') {
    nextDecisionLap = 'RE-EVALUATE AFTER PIT EXIT';
  } else if (primary.action === 'PIT WINDOW OPEN') {
    nextDecisionLap = `RE-EVALUATE LAP ${currentLap + 1}`;
  } else if (primary.action === 'PIT WINDOW OPEN') {
    nextDecisionLap = `RE-EVALUATE LAP ${currentLap + 1}`;
  } else {
    // STAY OUT: Re-evaluate before optimal stop or at intermediate checkpoint
    const lapsUntilStop = Math.max(1, displayedOptimalLap - currentLap);
    const reEvalDelta = Math.min(3, Math.max(1, Math.floor(lapsUntilStop / 2) || 1));
    const reEvalLap = Math.min(displayedOptimalLap, currentLap + reEvalDelta);
    nextDecisionLap = `RE-EVALUATE LAP ${reEvalLap}`;
  }

  // Recommended Action text
  let recommendedAction = isOpeningStint
    ? `Continue on ${compound} (Opening stint: Target stop Lap ${displayedOptimalLap} → ${primaryTargetCompound})`
    : primary.description;

  // Integrate Tyre Recovery Intelligence into STAY OUT prescription
  if (!isOpeningStint && primary.action === 'STAY OUT' && tyreRecovery?.isRecoverable && tyreRecovery?.recoveryPotentialPct >= 50) {
    recommendedAction = `STAY OUT — 2 LAP MANAGEMENT (${primary.description})`;
  }

  // ── Synthesize Dynamic Physical Reasoning ──
  const currentPaceLoss = getDegradationDelta(compound, tyreAge, setup, thermalState);
  let reason = '';

  if (isOpeningStint) {
    reason = `Opening stint favors establishing baseline pace. Lap ${displayedOptimalLap} is currently the optimal projected pit lap, but strategy will be re-evaluated on Lap ${MIN_STINT_LAPS + 1}.`;
  } else if (primary.action === 'STAY OUT') {
    const optStr = displayedOptimalLap !== 'N/A' ? `Lap ${displayedOptimalLap}` : 'scheduled window';
    const nextDecStr = nextDecisionLap.replace('RE-EVALUATE ', '');
    if (trafficNow.risk === 'HIGH' || trafficNow.risk === 'MEDIUM') {
      reason = `Current conditions favor staying out to avoid heavy pit-exit traffic (${trafficNow.details}). ${optStr} is currently the optimal projected pit lap, but the strategy will be re-evaluated on ${nextDecStr} as tyre, traffic, thermal and competitor conditions evolve.`;
    } else if (tyreTemperature === 'OPTIMAL' || tyreTemperature === 'WARM') {
      reason = `Current conditions favor staying out. ${optStr} is currently the optimal projected pit lap, but the strategy will be re-evaluated on ${nextDecStr} as tyre, traffic, thermal and competitor conditions evolve.`;
    } else {
      reason = `Current clean-air lap times favor staying out. ${optStr} is currently the optimal projected pit lap, with next strategy re-evaluation scheduled for ${nextDecStr}.`;
    }
  } else if (primary.action === 'PIT NOW') {
    if (isCliffReached) {
      reason = `Current ${compound} tyres have crossed the degradation cliff limit. Lap ${currentLap} is the optimal pit lap to prevent catastrophic pace drop. Strategy will be re-evaluated after pit exit.`;
    } else if (tyreTemperature === 'BLISTERING') {
      reason = `Thermal blistering is severe (+${thermalPenaltySec.toFixed(2)}s/lap penalty) and accelerating pace breakdown. Lap ${currentLap} is the optimal pit lap. Strategy will be re-evaluated after pit exit.`;
    } else if (tyreTemperature === 'HOT') {
      reason = `Thermal degradation is accelerating above operating window. Lap ${currentLap} is the optimal pit lap. Strategy will be re-evaluated after pit exit.`;
    } else if (trafficNow.risk === 'LOW') {
      reason = `Projected degradation exceeds pit-stop cost and pit-exit window is clear (${trafficNow.details}). Lap ${currentLap} is the optimal pit lap; strategy will be re-evaluated after pit exit.`;
    } else {
      reason = `Pace loss on ${compound} exceeds pit penalty threshold. Lap ${currentLap} is the optimal pit lap. Box now for fresh ${primary.targetCompound}; strategy will be re-evaluated after pit exit.`;
    }
  } else if (primary.action === 'PIT WINDOW OPEN') {
    if (trafficNow.risk === 'HIGH') {
      reason = `Immediate pit stop exits behind traffic. Extending by 1 lap allows clear rejoin window. Lap ${currentLap + 1} is the optimal pit lap; strategy will be re-evaluated on Lap ${currentLap + 1}.`;
    } else {
      reason = `One additional lap optimizes tyre temperature and stint balance before switching to ${primary.targetCompound}. Lap ${currentLap + 1} is the optimal pit lap; strategy will be re-evaluated on Lap ${currentLap + 1}.`;
    }
  } else if (primary.action === 'PIT WINDOW OPEN') {
    reason = `Push for 2 laps to build pit gap buffer against rivals while tyre degradation remains manageable. Lap ${currentLap + 2} is the optimal pit lap; strategy will be re-evaluated on Lap ${currentLap + 1}.`;
  }

  // Driver Behaviour Contextual Advisory
  let driverAdvisory = '';
  if (driverBehaviour) {
    if (driverBehaviour.state === 'OVERDRIVING') {
      driverAdvisory = ' OVERDRIVING detected: sharp throttle/brake transitions are accelerating tyre stress and thermal degradation.';
    } else if (driverBehaviour.state === 'ATTACK') {
      driverAdvisory = ' ATTACK driving style is increasing projected tyre degradation (+3.5%).';
    } else if (driverBehaviour.state === 'CONSERVATIVE') {
      driverAdvisory = ' CONSERVATIVE pace: tyre preservation optimal.';
    }
  }
  if (driverAdvisory) {
    reason += driverAdvisory;
  }

  // Opportunity Detector Advisory (does not override deterministic pit logic)
  if (opportunityReport?.primaryOpportunity && opportunityReport.primaryOpportunity.score >= 70) {
    reason += ` Opportunity: ${opportunityReport.primaryOpportunity.title} (${opportunityReport.primaryOpportunity.score}% score) — ${opportunityReport.primaryOpportunity.reason}`;
  }

  // Alternative synthesis
  let alternativeObj = null;
  if (alternative && alternative !== primary) {
    const altReason = (alternative.action === 'PIT NOW')
      ? `Fresh ${alternative.targetCompound} tyres eliminate degradation, but current stay-out pace is faster overall.`
      : `Staying out remains an option, but carries higher wear risk than pitting for ${primary.targetCompound}.`;

    const altGain = Math.max(0.1, Number((alternative.totalTime - (candidates[2]?.totalTime || alternative.totalTime + 1.2)).toFixed(1)));

    alternativeObj = {
      action: alternative.action,
      targetCompound: alternative.targetCompound,
      recommendedAction: alternative.description,
      reason: altReason,
      projectedGain: altGain > MAX_STRATEGY_TIME_DELTA ? 0.0 : altGain,
      trafficRisk: alternative.trafficRisk,
      stopLap: alternative.stopLap
    };
  }

  const cssClass = primary.action === 'PIT NOW' 
    ? 'pit-now' 
    : (primary.action.includes('PIT') ? 'pit-warning' : 'stay-out');

  // Strategic margin calculation for confidence weighting
  let strategicMarginSec = 1.5;
  if (alternative && alternative !== primary) {
    strategicMarginSec = Math.abs(alternative.totalTime - primary.totalTime);
  } else if (candidates.length >= 2) {
    strategicMarginSec = Math.abs(candidates[1].totalTime - candidates[0].totalTime);
  }

  const predConfidence = calculatePredictionConfidence({
    compound,
    tyreAge,
    setup,
    thermalState,
    lapsObserved: tyreAge,
    trafficRisk: (primary.action === 'PIT NOW') ? trafficNow.risk : trafficNext.risk,
    driverBehaviour,
    strategicMarginSec
  });

  return {
    action: primary.action,
    recommendedAction,
    targetCompound: primary.targetCompound,
    lapsUntilAction,
    reason,
    projectedGain,
    trafficRisk: (primary.action === 'PIT NOW') ? trafficNow.risk : trafficNext.risk,
    trafficDetails: (primary.action === 'PIT NOW') ? trafficNow.details : trafficNext.details,
    tyreTemperature,
    tyreTempC: Math.round(currentT),
    tyreAge,
    projectedDegradation: currentPaceLoss,
    pitLoss: getEffectivePitCost(),
    optimalLap: displayedOptimalLap,
    nextDecisionLap,
    confidence: predConfidence.level,
    confidenceScore: predConfidence.score,
    confidenceLevel: predConfidence.level,
    confidenceUncertainty: predConfidence.uncertainty,
    confidenceReasons: predConfidence.reasons,
    confidenceComponents: predConfidence.components,
    candidates,
    alternative: alternativeObj,
    driverBehaviourState: driverBehaviour?.state || 'BALANCED',
    driverAdvisory: driverAdvisory.trim(),
    tyreRecovery: tyreRecovery || null,
    opportunityReport: opportunityReport || null,

    // ── Backwards Compatibility Aliases ──
    state: primary.action,
    cssClass,
    nextCompound: primary.targetCompound,
    strategyConfidence: predConfidence.level,
    confNote: (projectedGain !== null && !isNaN(projectedGain)) ? `Projected Gain: +${projectedGain.toFixed(1)}s vs alternative` : 'Opening stint evaluation',
    reasoning: reason,
    counterfactualDelta: (projectedGain !== null && !isNaN(projectedGain)) ? projectedGain : 0.0,
    fuelNeeded: calculateOptimalRefuelAmount(lapsRemaining)
  };
}

/**
 * Backward compatible alias for existing consumers.
 */
export function getRecommendation(compound, tyreAge, currentLap, fuelPct, setup = null, allCars = null, thermalState = null) {
  return getPrescription(compound, tyreAge, currentLap, fuelPct, setup, allCars, thermalState);
}

export function getTotalLaps() {
  // Use circuit-specific lap count if available, fall back to model data
  if (raceConfig && raceConfig.trackId && CIRCUITS[raceConfig.trackId]) {
    return CIRCUITS[raceConfig.trackId].raceLaps;
  }
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
