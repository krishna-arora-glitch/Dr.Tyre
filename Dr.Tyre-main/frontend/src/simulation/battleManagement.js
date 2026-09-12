/**
 * battleManagement.js — Battle-Aware Tyre Management Engine
 * 
 * Evaluates: "Is pushing worth the tyre cost RIGHT NOW?"
 * 
 * Compares:
 *   A) ATTACK / PUSH scenario
 *   B) MANAGE / SAVE scenario
 * and calculates expected values and dynamic battle prescriptions without
 * ever replacing or duplicating the authoritative degradation model.
 */

import { getMarginalDegRate, getDegradationDelta, COMPOUND_THERMAL_WINDOWS, calculateThermalPenalty } from './strategy.js';

/**
 * Evaluates Battle-Aware Tyre Management for a car.
 * 
 * @param {Object} car - Current car simulation state
 * @param {Object|null} rivalAhead - Immediate car ahead (if any)
 * @param {Object|null} rivalBehind - Immediate car behind (if any)
 * @param {number} currentLap - Current race lap
 * @param {number} totalLaps - Total race distance
 * @param {Object|null} modelData - Authoritative ML/pipeline model data
 * @returns {Object} Battle intelligence report
 */
export function evaluateBattleManagement(car, rivalAhead, rivalBehind, currentLap, totalLaps, modelData = null) {
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  const setup = car.setup || null;
  const thermalState = car.thermalState || { tyreTemp: 100, optimalTemp: 100, thermalPenalty: 0.0 };
  const lapsRemaining = Math.max(0, totalLaps - currentLap);
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const cliffLap = modelData?.compounds?.[compound]?.cliff_lap || 32;

  // 1. Authoritative baseline degradation rate (s/lap)
  const baseMarginalDeg = getMarginalDegRate(compound, tyreAge, setup);
  const currentPaceLoss = getDegradationDelta(compound, tyreAge, setup, thermalState);

  // 2. Gaps and DRS status
  const gapAhead = (rivalAhead && rivalAhead.gapToAhead !== undefined) ? rivalAhead.gapToAhead : (rivalAhead ? 2.5 : 999.0);
  const gapBehind = (rivalBehind && rivalBehind.gapToBehind !== undefined) ? rivalBehind.gapToBehind : (rivalBehind ? 2.5 : 999.0);
  const hasDRSAhead = gapAhead <= 1.0;
  const isThreatenedBehind = gapBehind <= 1.2;

  // Driver aggression & behaviour modifier
  const driverAggression = car.driverBehaviour?.aggressionIndex ?? 50; // [0, 100]
  const stressMod = car.driverBehaviour?.tyreStressModifier ?? 1.0;

  // ─────────────────────────────────────────────────────────────
  // A) ATTACK SCENARIO PROJECTION
  // ─────────────────────────────────────────────────────────────
  // Immediate lap gain from pushing: grip utilization + throttle commitment (+ DRS if applicable)
  const basePushGain = 0.28 + (driverAggression / 100) * 0.22; // 0.28s to 0.50s
  const drsBoost = hasDRSAhead ? 0.28 : 0.0;
  const attackLapGain = Math.round((basePushGain + drsBoost) * 100) / 100;

  // Additional tyre degradation cost of attacking
  // Extra stress increases wear rate + raises tyre carcass temperature
  const deltaThermalDeg = (thermalState.tyreTemp > win.opt) ? 0.025 : 0.012;
  const attackTyreCost = Math.round((baseMarginalDeg * 0.24 * stressMod + deltaThermalDeg) * 1000) / 1000;

  // Overtake Probability calculation
  let overtakeProbability = 0;
  if (rivalAhead && gapAhead < 4.0) {
    // Relative tyre degradation comparison
    const rivalCompound = rivalAhead.compound || 'MEDIUM';
    const rivalAge = Math.max(0, rivalAhead.tyreAge || 0);
    const rivalDegRate = getMarginalDegRate(rivalCompound, rivalAge, rivalAhead.setup);
    const degAdvantage = rivalDegRate - baseMarginalDeg; // Positive = we degrade slower than rival

    // Proximity factor: exponential decay with distance
    const distFactor = Math.max(0, 1.0 - (gapAhead / 3.0));

    // DRS bonus
    const drsFactor = hasDRSAhead ? 0.25 : 0.0;

    // Base probability from pace gain and distance
    const rawProb = (distFactor * 0.55) + drsFactor + (degAdvantage > 0 ? 0.15 : -0.10);
    overtakeProbability = Math.round(Math.min(0.92, Math.max(0.05, rawProb)) * 100);
  }

  // Future cumulative time cost: extra wear carried across future laps before next pit/finish
  const stintHorizon = Math.min(10, lapsRemaining);
  const attackFutureTimeCost = Math.round((attackTyreCost * stintHorizon * 0.55) * 100) / 100;

  // Expected Value of Attack
  // AttackValue = ImmediateGain + (P(Overtake) * CleanAirBonus) - FutureCost - ThermalRiskPenalty
  const cleanAirTrackPositionBonus = 1.4; // Seconds of clean air advantage per lap over stint
  const thermalRiskPenalty = (thermalState.tyreTemp > win.blister - 4) ? 0.8 : 0.0;
  const expectedPositionGain = Math.round(((overtakeProbability / 100) * cleanAirTrackPositionBonus) * 100) / 100;
  const attackValue = Math.round((attackLapGain + expectedPositionGain - attackFutureTimeCost - thermalRiskPenalty) * 100) / 100;

  // ─────────────────────────────────────────────────────────────
  // B) MANAGEMENT SCENARIO PROJECTION
  // ─────────────────────────────────────────────────────────────
  // Conceding immediate pace to preserve tyre carcass & drop thermal load
  const managementLapLoss = Math.round((0.14 + (0.12 * (1.0 - (driverAggression / 100)))) * 100) / 100;
  const managementTyreSaving = Math.round((baseMarginalDeg * 0.22 + 0.015) * 1000) / 1000;
  const futurePerformanceGain = Math.round((managementTyreSaving * stintHorizon * 0.75) * 100) / 100;

  // Future attack potential: having fresh rubber in remaining laps
  const futureAttackPotential = Math.round(Math.min(95, Math.max(10, 45 + (managementTyreSaving * 400) - (tyreAge * 1.2))));
  const managementValue = Math.round((futurePerformanceGain + (futureAttackPotential / 100 * 0.6) - managementLapLoss) * 100) / 100;

  // ─────────────────────────────────────────────────────────────
  // C) STRATEGIC BATTLE DECISION & WORDING
  // ─────────────────────────────────────────────────────────────
  let decision = 'MANAGE TYRES';
  let decisionReason = 'Preserve tyre life and maintain stable thermal operating window.';
  let decisionClass = 'manage';
  let isWorthCost = false;

  // Safety overrides first: thermal blistering or cliff proximity prevents attack
  if (thermalState.tyreTemp > win.blister) {
    decision = 'MANAGE TYRES — BLISTERING HAZARD';
    decisionReason = `Tyre temperature (${Math.round(thermalState.tyreTemp)}°C) exceeds blister threshold. Pushing risks structural failure.`;
    decisionClass = 'critical';
    isWorthCost = false;
  } else if (tyreAge >= cliffLap - 1) {
    decision = 'MANAGE TYRES — DEGRADATION CLIFF REACHED';
    decisionReason = `Tyre is on Lap ${tyreAge} of ${cliffLap} cliff threshold. Preserving carcass integrity is paramount.`;
    decisionClass = 'critical';
    isWorthCost = false;
  } else if (isThreatenedBehind && gapBehind < 1.0) {
    decision = 'DEFENSIVE PUSH REQUIRED';
    decisionReason = `Rival behind is within DRS window (+${gapBehind.toFixed(1)}s). Deploy short push to break DRS tow.`;
    decisionClass = 'attack';
    isWorthCost = true;
  } else if (hasDRSAhead && overtakeProbability >= 45 && attackValue >= managementValue) {
    decision = 'ATTACK IS WORTH THE TYRE COST';
    decisionReason = `DRS tow and ${overtakeProbability}% overtake probability justify +${attackTyreCost.toFixed(3)}s/lap tyre degradation investment.`;
    decisionClass = 'attack';
    isWorthCost = true;
  } else if (attackValue > managementValue + 0.25 && gapAhead < 2.5) {
    decision = 'ATTACK IS WORTH THE TYRE COST';
    decisionReason = `Net expected gain (+${attackValue.toFixed(2)}s) exceeds management preservation value (+${managementValue.toFixed(2)}s).`;
    decisionClass = 'attack';
    isWorthCost = true;
  } else {
    decision = 'MANAGE TYRES';
    decisionReason = `Future tyre preservation (+${managementTyreSaving.toFixed(3)}s/lap) delivers superior total race time.`;
    decisionClass = 'manage';
    isWorthCost = false;
  }

  return {
    decision,
    decisionReason,
    decisionClass,
    isWorthCost,
    attack: {
      lapGain: attackLapGain,
      tyreCost: attackTyreCost,
      overtakeProbability,
      futureTimeCost: attackFutureTimeCost,
      expectedValue: attackValue,
      expectedPositionGain
    },
    manage: {
      lapLoss: managementLapLoss,
      tyreSaving: managementTyreSaving,
      futurePerformanceGain,
      futureAttackPotential,
      expectedValue: managementValue
    },
    context: {
      compound,
      tyreAge,
      gapAhead: rivalAhead ? gapAhead : null,
      gapBehind: rivalBehind ? gapBehind : null,
      hasDRS: hasDRSAhead,
      lapsRemaining
    }
  };
}
