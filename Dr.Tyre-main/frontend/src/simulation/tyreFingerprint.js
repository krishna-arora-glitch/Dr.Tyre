/**
 * tyreFingerprint.js — Tyre Fingerprint Engine
 * 
 * Generates a normalized 7-vector behavioural profile [0, 100] for any tyre/stint:
 *   1. Warm-up behaviour
 *   2. Peak grip availability
 *   3. Thermal stress
 *   4. Mechanical wear
 *   5. Sliding
 *   6. Degradation rate
 *   7. Performance recovery potential
 * 
 * Reuses authoritative models without duplicate equations and provides
 * stint-to-stint comparisons when historical telemetry is recorded.
 */

import { getMarginalDegRate, getDegradationDelta, COMPOUND_THERMAL_WINDOWS } from './strategy.js';
import { evaluateTyreRecovery } from './tyreRecovery.js';

/**
 * Computes the 7-vector Tyre Fingerprint profile for a car.
 * 
 * @param {Object} car - Simulated car state
 * @param {Object|null} modelData - Authoritative ML/pipeline model data
 * @returns {Object} Tyre Fingerprint profile and comparison metrics
 */
export function computeTyreFingerprint(car, modelData = null) {
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  const setup = car.setup || null;
  const thermalState = car.thermalState || { tyreTemp: 100, optimalTemp: 100, thermalPenalty: 0.0 };
  const currentTemp = thermalState.tyreTemp ?? 100;
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const cliffLap = modelData?.compounds?.[compound]?.cliff_lap || 32;

  // 1. WARM-UP (0-100)
  // Distance from operating window. Reaches 100 once tyre enters optimum range.
  let warmup = 100;
  if (currentTemp < win.opt - 2) {
    const coldDeficit = win.opt - currentTemp; // e.g. 100 - 80 = 20
    warmup = Math.max(10, Math.min(100, Math.round(100 - (coldDeficit * 3.5))));
  } else if (tyreAge <= 2) {
    warmup = Math.round(70 + (tyreAge * 15));
  }

  // 2. PEAK GRIP (0-100)
  // Maximum usable grip available right now. High when temp is near optimum and degradation is low.
  const tempDeltaFromOpt = Math.abs(currentTemp - win.opt);
  const thermalGripFactor = Math.max(0.3, 1.0 - (tempDeltaFromOpt / 22.0));
  const degPaceLoss = getDegradationDelta(compound, tyreAge, setup, thermalState);
  const ageGripFactor = Math.max(0.15, 1.0 - (degPaceLoss / 3.2));
  const downforceBonus = setup ? (setup.downforceLevel === 'HIGH' ? 0.06 : setup.downforceLevel === 'LOW' ? -0.04 : 0.0) : 0.0;
  const peakGrip = Math.round(Math.min(100, Math.max(10, (thermalGripFactor * 0.5 + ageGripFactor * 0.5 + downforceBonus) * 100)));

  // 3. THERMAL STRESS (0-100)
  // Thermal load and delta above compound optimum
  const tempAboveOpt = Math.max(0, currentTemp - win.opt);
  const blisterRange = Math.max(1, win.blister - win.opt);
  const thermalRatio = tempAboveOpt / blisterRange;
  const penaltyContribution = (thermalState.thermalPenalty || 0) * 40; // 0.5s penalty = +20 stress
  const thermalStress = Math.round(Math.min(100, Math.max(12, 35 + (thermalRatio * 45) + penaltyContribution)));

  // 4. MECHANICAL WEAR (0-100)
  // Progressive physical tread loss across the stint
  const wearFraction = Math.min(1.0, tyreAge / cliffLap);
  const stressCoef = (car.lapStress?.stressScore ? car.lapStress.stressScore / 100 : 0.5);
  const mechanicalWear = Math.round(Math.min(100, Math.max(5, (wearFraction * 75 + stressCoef * 25))));

  // 5. SLIDING (0-100)
  // Slip angle, lateral loads, driver aggression transitions, and aerowake dirty air
  const driverTransitions = car.driverBehaviour?.smoothnessScore ? (100 - car.driverBehaviour.smoothnessScore) : 45;
  const isDirtyAir = (car.inDirtyAir || (car.gapToAhead !== undefined && car.gapToAhead < 1.2));
  const dirtyAirPenalty = isDirtyAir ? 18 : 0;
  const corneringStress = car.lapStress?.corneringG ? Math.min(30, car.lapStress.corneringG * 6) : 15;
  const sliding = Math.round(Math.min(100, Math.max(15, (driverTransitions * 0.45) + corneringStress + dirtyAirPenalty + (tempAboveOpt > 5 ? 12 : 0))));

  // 6. DEGRADATION (0-100)
  // Authoritative degradation rate normalized against maximum expected GP degradation (0.15 s/lap)
  const marginalDeg = getMarginalDegRate(compound, tyreAge, setup);
  const effectiveSlope = marginalDeg + (thermalState.thermalPenalty ? thermalState.thermalPenalty * 0.12 : 0);
  const degradation = Math.round(Math.min(100, Math.max(5, (effectiveSlope / 0.15) * 100)));

  // 7. RECOVERY (0-100)
  // Performance recoverable through thermal management (reusing authoritative tyreRecovery)
  const recoveryEval = car.tyreRecovery || evaluateTyreRecovery(car, modelData);
  const recovery = Math.round(Math.min(100, Math.max(5, recoveryEval.recoveryPotentialPct ?? 40)));

  const fingerprint = {
    warmup,
    peakGrip,
    thermalStress,
    mechanicalWear,
    sliding,
    degradation,
    recovery
  };

  // ─────────────────────────────────────────────────────────────
  // STINT COMPARISON ENGINE
  // ─────────────────────────────────────────────────────────────
  let comparison = null;
  const history = car.stintFingerprints || [];

  if (history.length > 0) {
    const previousStint = history[history.length - 1];
    const thermalDiffPct = Math.round(((thermalStress - previousStint.thermalStress) / Math.max(1, previousStint.thermalStress)) * 100);
    const slidingDiffPct = Math.round(((sliding - previousStint.sliding) / Math.max(1, previousStint.sliding)) * 100);

    const notes = [];
    if (Math.abs(thermalDiffPct) >= 8) {
      notes.push(`Thermal sensitivity is ${Math.abs(thermalDiffPct)}% ${thermalDiffPct > 0 ? 'higher' : 'lower'} than previous ${previousStint.compound} stint.`);
    }
    if (Math.abs(slidingDiffPct) >= 10) {
      notes.push(`Current tyre shows ${Math.abs(slidingDiffPct)}% ${slidingDiffPct > 0 ? 'more' : 'less'} sliding than previous stint.`);
    }
    if (notes.length === 0) {
      notes.push(`Wear profile conforms closely (within 5%) to previous ${previousStint.compound} stint baseline.`);
    }

    comparison = {
      previousStintCompound: previousStint.compound,
      previousStintAge: previousStint.tyreAge,
      thermalDiffPct,
      slidingDiffPct,
      notes
    };
  }

  return {
    compound,
    tyreAge,
    fingerprint,
    comparison
  };
}

/**
 * Records the current stint fingerprint snapshot into history upon pit stop.
 * 
 * @param {Object} car - Car taking pit stop
 * @param {Object} fingerprintResult - Output of computeTyreFingerprint
 */
export function archiveStintFingerprint(car, fingerprintResult) {
  if (!car.stintFingerprints) {
    car.stintFingerprints = [];
  }
  car.stintFingerprints.push({
    compound: fingerprintResult.compound,
    tyreAge: fingerprintResult.tyreAge,
    ...fingerprintResult.fingerprint,
    timestamp: Date.now()
  });
}
