/**
 * informationValue.js — Information Value Engine
 * 
 * Evaluates: "What is the value of collecting more tyre telemetry data?"
 * 
 * Information Value = (Expected Uncertainty Reduction × Strategic Usefulness) - Expected Time Cost
 * 
 * Strict Constraint:
 *   SAFETY / PERFORMANCE PRESERVATION > INFORMATION VALUE
 *   If a tyre is blistering, nearing its cliff, or experiencing severe degradation,
 *   Information Value is set to zero and no data extension is permitted.
 */

import { getDegradationUncertainty, getMarginalDegRate, getCompoundCliffLap, COMPOUND_THERMAL_WINDOWS } from './strategy.js';

/**
 * Evaluates the Information Value of extending the current stint by 1-3 laps.
 * 
 * @param {Object} car - Current car state
 * @param {number} currentLap - Current race lap
 * @param {number} totalLaps - Total race laps
 * @param {Object|null} modelData - Authoritative ML/pipeline model data
 * @returns {Object} Information Value report and recommendation
 */
export function evaluateInformationValue(car, currentLap, totalLaps, modelData = null) {
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  const setup = car.setup || null;
  const thermalState = car.thermalState || { tyreTemp: 100, optimalTemp: 100, thermalPenalty: 0.0 };
  const lapsRemaining = Math.max(0, totalLaps - currentLap);
  const cliffLap = getCompoundCliffLap(compound);
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;

  // 1. Check strict safety overrides first
  const isOverheating = thermalState.tyreTemp > win.blister;
  const isNearCliff = tyreAge >= cliffLap - 1;
  const isCriticalWear = car.tyreHealth && car.tyreHealth.gripLevel < 25;

  if (isOverheating || isNearCliff || isCriticalWear) {
    return {
      status: 'SAFETY CRITICAL — NO DATA EXTENSION',
      uncertaintyLevel: 'IRRELEVANT (SAFETY FIRST)',
      uncertaintyBand: 0.0,
      expectedTimeCost: 99.0,
      uncertaintyReductionPct: 0,
      strategicUsefulness: 'LOW',
      informationValue: 0.0,
      lapsToExtend: 0,
      recommendation: 'DO NOT EXTEND FOR DATA — BOX AT TARGET PIT WINDOW',
      reason: isOverheating
        ? `Thermal state (${Math.round(thermalState.tyreTemp)}°C) exceeds blister threshold. Safety takes strict precedence over data collection.`
        : `Tyre is within 1 lap of physical degradation cliff (${cliffLap} laps). Pushing further risks carcass failure.`,
      isSafetyCritical: true
    };
  }

  // 2. Authoritative model uncertainty from 95% Confidence Interval
  const degUncertainty = getDegradationUncertainty(compound, tyreAge, setup);
  const baseDegRate = getMarginalDegRate(compound, tyreAge, setup);

  // 3. Observed laps and Compound Information State
  // New stints or rare compounds have fewer observations and wider variance
  const observedLaps = tyreAge;
  let compoundTrust = 'MEDIUM';
  let uncertaintyLevel = 'MEDIUM';

  if (degUncertainty > 0.12 || observedLaps < 5) {
    uncertaintyLevel = 'HIGH';
    compoundTrust = 'LOW';
  } else if (degUncertainty < 0.05 && observedLaps >= 14) {
    uncertaintyLevel = 'LOW';
    compoundTrust = 'HIGH';
  }

  // 4. Strategic Usefulness: How much does resolving this uncertainty help the rest of the race?
  // If race is almost over (< 6 laps remaining), knowing future deg rate doesn't matter much
  let strategicUsefulnessScore = 0.5; // [0.0, 1.0]
  let strategicUsefulnessText = 'MEDIUM';

  if (lapsRemaining < 6) {
    strategicUsefulnessScore = 0.1;
    strategicUsefulnessText = 'LOW';
  } else if (lapsRemaining > 20 && uncertaintyLevel === 'HIGH') {
    strategicUsefulnessScore = 0.9;
    strategicUsefulnessText = 'HIGH';
  } else if (lapsRemaining > 12) {
    strategicUsefulnessScore = 0.65;
    strategicUsefulnessText = 'MEDIUM';
  }

  // 5. Calculate trade-off over an exploratory 2 to 3 lap window
  const proposedLaps = (uncertaintyLevel === 'HIGH' && lapsRemaining > 15) ? 3 : 2;
  
  // Expected time cost: additional pace loss suffered across the extended laps
  const expectedTimeCost = Math.round((baseDegRate * proposedLaps * 1.35) * 100) / 100;

  // Expected uncertainty reduction: running more laps adds telemetry samples, narrowing CI
  // Power law convergence: ~15% reduction per additional clean lap
  const uncertaintyReductionPct = Math.round(Math.min(55, Math.max(10, (1.0 - Math.pow(0.85, proposedLaps)) * 100)));

  // Net Information Value (s): (Reduction × Strategic Benefit in clean pace) - Time Cost
  const strategicPaceBenefitSec = (uncertaintyReductionPct / 100) * strategicUsefulnessScore * 1.8;
  const netInfoValue = Math.round((strategicPaceBenefitSec - (expectedTimeCost * 0.4)) * 100) / 100;

  // 6. Recommendation formulation
  let recommendation = 'STANDARD STINT EXECUTION';
  let lapsToExtend = 0;

  if (uncertaintyLevel === 'HIGH' && strategicUsefulnessScore >= 0.6 && netInfoValue > 0.15) {
    lapsToExtend = proposedLaps;
    recommendation = `EXTEND ${proposedLaps} LAPS TO COLLECT TYRE DATA`;
  } else if (uncertaintyLevel === 'LOW' || lapsRemaining < 8) {
    recommendation = 'EXECUTE PLANNED STRATEGY (CONFIDENCE HIGH)';
  } else {
    recommendation = 'HOLD STINT TARGET (BALANCED DATA)';
  }

  return {
    status: 'ACTIVE MONITORING',
    uncertaintyLevel,
    compoundTrust,
    uncertaintyBand: Math.round(degUncertainty * 1000) / 1000,
    expectedTimeCost,
    uncertaintyReductionPct,
    strategicUsefulness: strategicUsefulnessText,
    strategicUsefulnessScore,
    informationValue: netInfoValue,
    lapsToExtend,
    recommendation,
    reason: (lapsToExtend > 0)
      ? `${compound} degradation CI is wide (±${degUncertainty.toFixed(3)}s). Extending ${lapsToExtend} laps reduces degradation variance by ~${uncertaintyReductionPct}% to optimize subsequent stint windows.`
      : `Degradation uncertainty is sufficiently bounded (±${degUncertainty.toFixed(3)}s) or race horizon is short. Proceed with scheduled pit window.`,
    isSafetyCritical: false
  };
}
