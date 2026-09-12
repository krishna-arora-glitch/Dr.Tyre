/**
 * tyreRecovery.js — Tyre Recovery Intelligence Engine
 * 
 * Evaluates whether performance degradation can be recovered via tyre thermal management.
 * 
 * PHYSICAL LAW:
 * Physical tread wear and carcass fatigue are strictly irreversible.
 * Only thermal overheating, blistering friction, and transient tyre scrub
 * can be mitigated by management (lift-and-coast, gentler trail braking).
 */

import { COMPOUND_THERMAL_WINDOWS, calculateThermalPenalty, getMarginalDegRate, getDegradationDelta } from './strategy.js';

/**
 * Evaluates tyre recovery potential under a 1-3 lap management horizon.
 *
 * @param {Object} car - Simulated car object
 * @param {Object} [modelData] - Telemetry model parameters
 * @param {number} [managementHorizonLaps=2] - Stint lookahead window (default 2 laps)
 * @returns {Object} Recovery diagnostic report
 */
export function evaluateTyreRecovery(car, modelData = null, managementHorizonLaps = 2) {
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  const setup = car.setup || null;
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const currentTemp = car.thermalState?.tyreTemp !== undefined ? car.thermalState.tyreTemp : (car.tyreTemp || win.opt);
  const optTemp = win.opt;
  const deltaT = Math.max(0, currentTemp - optTemp);

  // 1. Current authoritative baseline degradation and thermal penalty
  const currentPenaltyObj = calculateThermalPenalty(compound, tyreAge, currentTemp);
  const currentThermalPenalty = currentPenaltyObj.thermalPenalty;
  const currentMarginalDeg = car.dynamicDegradation?.currentRate || getMarginalDegRate(compound, tyreAge, setup);

  // 2. Simulate 2-Lap Pushing Scenario (Aggressive throttle, late braking, high scrub)
  // Temperature continues climbing or remains in overheat zone (+1.5°C per lap)
  const pushingTemp = Math.min(win.blister + 6, currentTemp + (1.2 * managementHorizonLaps));
  const pushingThermalObj = calculateThermalPenalty(compound, tyreAge + managementHorizonLaps, pushingTemp);
  const pushingThermalPenalty = pushingThermalObj.thermalPenalty;
  const pushingBaseDeg = getMarginalDegRate(compound, tyreAge + managementHorizonLaps, setup);
  const expectedPushingDegRate = Number((pushingBaseDeg + (pushingThermalPenalty * 0.12)).toFixed(3));

  // 3. Simulate 2-Lap Management Scenario (Lift-and-coast, reduced lateral slip)
  // Ambient reference track temperature
  const ambientTemp = 32.0;
  // F1 car natural cooling rate: gammaCool * (T_tyre - T_ambient) * cooling horizon
  // Under management, heat generation drops by ~40%, allowing net cooling of ~3-5°C per managed lap
  const coolingPerManagedLap = Math.min(4.5, Math.max(0.8, 0.032 * (currentTemp - ambientTemp) * 1.5));
  const totalCooling = coolingPerManagedLap * managementHorizonLaps;
  // Tyre cools down towards optimal window, but cannot drop below optimal temp on a hot circuit
  const managedTemp = Math.max(optTemp, currentTemp - totalCooling);

  const managedThermalObj = calculateThermalPenalty(compound, tyreAge + managementHorizonLaps, managedTemp);
  const managedThermalPenalty = managedThermalObj.thermalPenalty;
  const managedBaseDeg = getMarginalDegRate(compound, tyreAge + managementHorizonLaps, setup);
  const expectedManagedDegRate = Number((managedBaseDeg + (managedThermalPenalty * 0.12)).toFixed(3));

  // 4. Recoverable Performance Calculation
  // Delta between pushing and managed degradation rate in s/lap
  const recoverableDelta = Math.max(0, Number((expectedPushingDegRate - expectedManagedDegRate).toFixed(3)));

  // Relative recovery potential (0% to 100%)
  // If tyre is old and near cliff, wear dominates and recovery potential is naturally low.
  // If tyre is young but overheated, recovery potential is high.
  let recoveryPotential = 0;
  if (currentThermalPenalty > 0.05) {
    const thermalShareOfWear = Math.min(1.0, currentThermalPenalty / Math.max(0.1, currentMarginalDeg));
    recoveryPotential = Math.round(Math.min(95, Math.max(10, (thermalShareOfWear * 70) + (recoverableDelta / Math.max(0.01, expectedPushingDegRate)) * 60)));
  } else {
    // Already near optimal temperature: very little thermal headroom to recover
    recoveryPotential = Math.round(Math.max(5, Math.min(25, (deltaT / 10.0) * 20)));
  }

  // 5. Narrative Explanation & Physical Diagnosis
  let explanation = '';
  let managementFeasible = false;
  let recommendedTactic = 'MAINTAIN PACE';

  if (deltaT >= 8.0 && currentThermalPenalty > 0.25) {
    explanation = `Thermal load is critically elevated (+${deltaT.toFixed(1)}°C above window, ${currentThermalPenalty.toFixed(2)}s penalty). 2-lap lift-and-coast can recover ${recoverableDelta.toFixed(3)} s/lap.`;
    managementFeasible = true;
    recommendedTactic = '2-LAP LIFT & COAST';
  } else if (deltaT >= 3.5) {
    explanation = `Thermal load is elevated (+${deltaT.toFixed(1)}°C) but recoverable. Management can stabilize degradation slope.`;
    managementFeasible = true;
    recommendedTactic = 'TYRE MANAGEMENT (AVOID CURBS)';
  } else {
    explanation = 'Most degradation is age/wear driven. Carcass fatigue is irreversible; recovery potential is low.';
    managementFeasible = false;
    recommendedTactic = 'PUSH NORMALLY';
  }

  return {
    currentDegRate: Number(currentMarginalDeg.toFixed(3)),
    pushingDegRate: expectedPushingDegRate,
    managedDegRate: expectedManagedDegRate,
    recoverablePerformance: recoverableDelta,
    recoverableFormatted: `${recoverableDelta > 0 ? '-' : ''}${recoverableDelta.toFixed(3)} s/lap`,
    recoveryPotentialPct: recoveryPotential,
    currentTemp: Math.round(currentTemp),
    managedTemp: Math.round(managedTemp),
    coolingExpectedC: Number(totalCooling.toFixed(1)),
    horizonLaps: managementHorizonLaps,
    isRecoverable: managementFeasible,
    recommendedTactic,
    explanation
  };
}
