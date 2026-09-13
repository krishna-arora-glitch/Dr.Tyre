/**
 * raceIntelligenceFeed.js — Race Intelligence Feed Engine
 *
 * Central synthesis layer that reads ALL existing model outputs and
 * detects important race events. Does NOT duplicate any calculations.
 *
 * Architecture:
 *   EXISTING MODELS → EVENT DETECTION → FUSION → LIFECYCLE → RANKED ALERTS
 *
 * 10 Event Detectors:
 *   1. TYRE_DEGRADATION     ← dynamicDegradation, tyreHealth, strategy
 *   2. THERMAL_RISK         ← thermalState, COMPOUND_THERMAL_WINDOWS
 *   3. TYRE_CLIFF           ← tyreAge, getCompoundCliffLap(), dynamicDegradation
 *   4. UNDERCUT_OPPORTUNITY ← evaluate_undercut(), opportunityDetector
 *   5. OVERTAKE_OPPORTUNITY ← gaps, battleManagement
 *   6. EXTEND_STINT         ← optimal_stop_lap(), informationValue, tyreRecovery
 *   7. TYRE_RECOVERY        ← evaluateTyreRecovery()
 *   8. COMPETITOR_THREAT    ← opponentIntent, gaps, pace
 *   9. TRAFFIC              ← evaluatePitExitTraffic()
 *  10. DRIVER_BEHAVIOUR     ← driverBehaviour state, modifiers
 */

import {
  getMarginalDegRate, getDegradationDelta, getCompoundCliffLap,
  COMPOUND_THERMAL_WINDOWS, calculateThermalPenalty,
  evaluate_undercut, evaluatePitExitTraffic, getEffectivePitCost,
  getPrescription, getTotalLaps
} from './strategy.js';
import { calculatePredictionConfidence } from './predictionConfidence.js';
import {
  AlertCategory, AlertStatus, RadioCallType,
  categorizeAlert, fuseRelatedAlerts, deduplicateAndUpdateLifecycle, rankAlerts, selectTopAlerts
} from './alertPriorityEngine.js';

// ── Module State ─────────────────────────────────────────────────
let activeAlerts = [];
let learningLog = [];
let lastEvalLap = -1;

/**
 * Resets the intelligence feed state (e.g. on race restart).
 */
export function resetIntelligenceFeed() {
  activeAlerts = [];
  learningLog = [];
  lastEvalLap = -1;
}

/**
 * Main entry point. Evaluates the full race state and returns ranked alerts.
 * Should be called on lap-crossing, pit stop, SC/VSC, or compound change — NOT every frame.
 *
 * @param {Object} userCar - The user's car object (with all attached model state)
 * @param {Array} allCars - All 20 simulated cars
 * @param {number} currentLap - Current race lap
 * @param {number} totalLaps - Total race laps
 * @param {Object} modelData - Authoritative ML pipeline model data
 * @param {string} raceEvent - Current race state ('GREEN', 'SC', 'VSC')
 * @returns {Object} { alerts, topAlerts, learningLog, activeCount, opportunityCount }
 */
export function evaluateRaceIntelligence(userCar, allCars, currentLap, totalLaps, modelData, raceEvent = 'GREEN') {
  if (!userCar || currentLap <= 0) {
    return { alerts: activeAlerts, topAlerts: [], learningLog, activeCount: 0, opportunityCount: 0 };
  }

  // Throttle: don't re-evaluate on the same lap unless forced
  if (currentLap === lastEvalLap) {
    const ranked = rankAlerts(activeAlerts.filter(a => a.status !== AlertStatus.RESOLVED && a.status !== AlertStatus.EXPIRED));
    const top = selectTopAlerts(ranked, 5);
    return {
      alerts: activeAlerts,
      topAlerts: top,
      learningLog,
      activeCount: ranked.length,
      opportunityCount: ranked.filter(a => a.category === AlertCategory.OPPORTUNITY).length
    };
  }
  lastEvalLap = currentLap;

  // ── Run all 10 detectors ──
  const rawEvents = [];
  const sortedCars = [...allCars].sort((a, b) => (a.raceTime || 0) - (b.raceTime || 0));
  const userIndex = sortedCars.findIndex(c => c.id === userCar.id);
  const rivalAhead = userIndex > 0 ? sortedCars[userIndex - 1] : null;
  const rivalBehind = userIndex < sortedCars.length - 1 ? sortedCars[userIndex + 1] : null;
  const userPosition = userIndex + 1;

  rawEvents.push(...detectTyreDegradation(userCar, currentLap, modelData));
  rawEvents.push(...detectThermalRisk(userCar, currentLap, modelData));
  rawEvents.push(...detectTyreCliff(userCar, currentLap, modelData));
  rawEvents.push(...detectUndercutOpportunity(userCar, rivalAhead, currentLap, totalLaps, allCars, userPosition));
  rawEvents.push(...detectOvertakeOpportunity(userCar, rivalAhead, currentLap, userPosition));
  rawEvents.push(...detectExtendStint(userCar, currentLap, totalLaps, modelData, allCars));
  rawEvents.push(...detectTyreRecoveryOpp(userCar, currentLap, modelData));
  rawEvents.push(...detectCompetitorThreat(userCar, rivalBehind, currentLap, totalLaps, allCars, userPosition));
  rawEvents.push(...detectTraffic(userCar, currentLap, allCars));
  rawEvents.push(...detectDriverBehaviourAlert(userCar, currentLap));

  // ── Fusion: merge causally related signals ──
  const fused = fuseRelatedAlerts(rawEvents);

  // ── Lifecycle: deduplicate against existing, manage transitions ──
  activeAlerts = deduplicateAndUpdateLifecycle(fused, activeAlerts, currentLap);

  // ── Record learning log entries for resolved/expired predictions ──
  recordLearningOutcomes(userCar, currentLap);

  // ── Rank and select top alerts for display ──
  const displayable = activeAlerts.filter(a =>
    a.status !== AlertStatus.RESOLVED && a.status !== AlertStatus.EXPIRED
  );
  const ranked = rankAlerts(displayable);
  const topAlerts = selectTopAlerts(ranked, 5);

  return {
    alerts: activeAlerts,
    topAlerts,
    learningLog,
    activeCount: displayable.length,
    opportunityCount: displayable.filter(a => a.category === AlertCategory.OPPORTUNITY).length
  };
}

// ════════════════════════════════════════════════════════════════════
// EVENT DETECTORS — each reads existing model outputs, never duplicates
// ════════════════════════════════════════════════════════════════════

function detectTyreDegradation(car, lap, modelData) {
  const alerts = [];
  const dd = car.dynamicDegradation;
  const th = car.tyreHealth;
  if (!dd) return alerts;

  const compound = car.compound || 'MEDIUM';
  const expectedRate = getMarginalDegRate(compound, Math.max(0, (car.tyreAge || 0) - 3));
  const actualRate = dd.currentRate;
  const acceleration = dd.acceleration;

  // Only fire if degradation is meaningfully above expected
  if (actualRate <= expectedRate * 1.3 && !dd.isAccelerating) return alerts;

  const excessPct = expectedRate > 0.01 ? Math.round(((actualRate - expectedRate) / expectedRate) * 100) : 0;
  const severity = dd.isSevere ? 85 : (dd.isAccelerating ? 65 : 45);
  const urgency = dd.isSevere ? 80 : (dd.isAccelerating ? 60 : 35);

  // Project impact from existing models
  const projectedLoss2Laps = Number((acceleration * 2 + (actualRate - expectedRate) * 2).toFixed(2));

  // Confidence from existing engine
  const conf = getAlertConfidence(car);

  // Identify contributing factors from existing per-corner data
  const factors = [];
  if (car.individualTyres) {
    const corners = car.individualTyres;
    const maxCorner = ['FL', 'FR', 'RL', 'RR'].reduce((best, c) =>
      (corners[c]?.degradationRate || 0) > (corners[best]?.degradationRate || 0) ? c : best, 'FL');
    factors.push({ factor: `${maxCorner} leading degradation`, contribution: 35 });
  }
  if (car.thermalState && car.thermalState.thermalPenalty > 0.1) {
    factors.push({ factor: 'Thermal stress', contribution: 27 });
  }
  if (car.driverBehaviour && car.driverBehaviour.tyreStressModifier > 1.02) {
    factors.push({ factor: 'Driver aggression', contribution: 15 });
  }
  factors.push({ factor: 'Tyre age (' + (car.tyreAge || 0) + ' laps)', contribution: 100 - factors.reduce((s, f) => s + f.contribution, 0) });

  // Track segments contribution
  const trackMap = car.trackDegradationMap;
  if (trackMap && trackMap.segments) {
    const topSeg = trackMap.segments.slice().sort((a, b) => (b.intensity || 0) - (a.intensity || 0))[0];
    if (topSeg) {
      factors.push({ factor: `${topSeg.name} (highest workload)`, contribution: Math.round(topSeg.intensity / 3) });
    }
  }

  const whyNow = actualRate > expectedRate * 1.5
    ? `Degradation rate (+${actualRate.toFixed(3)} s/lap) has exceeded expected trajectory (+${expectedRate.toFixed(3)} s/lap) by ${excessPct}%.`
    : `Degradation acceleration detected: ${dd.accelFormatted}. Trend: ${dd.trend}.`;

  alerts.push({
    id: `TYRE_DEGRADATION_${car.id}`,
    type: 'TYRE_DEGRADATION',
    severity,
    category: categorizeAlert('TYRE_DEGRADATION', severity),
    title: dd.isSevere ? 'SEVERE TYRE DEGRADATION' : 'TYRE DEGRADATION ACCELERATING',
    shortMessage: `+${actualRate.toFixed(3)} s/lap (${excessPct > 0 ? '+' + excessPct + '% above expected' : dd.trend})`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency,
    raceImpact: Math.min(90, Math.round(projectedLoss2Laps * 100)),
    actionability: 80,
    timestamp: lap,
    carId: car.id,
    whyNow,
    impactIfUnchanged: `Projected +${projectedLoss2Laps.toFixed(2)}s pace loss over next 2 laps.`,
    relatedFactors: factors,
    recommendation: dd.isSevere ? 'PIT STOP OR IMMEDIATE MANAGEMENT' : '2-LAP MANAGEMENT',
    proposedRadio: {
      type: RadioCallType.MANAGEMENT,
      message: dd.isSevere
        ? 'Box, box. Tyres are gone.'
        : 'Manage tyres. Lift and coast. Two laps.'
    },
    status: AlertStatus.NEW,
    prediction: { metric: 'pace_loss_2_laps', predicted: projectedLoss2Laps, unit: 's', createdAtLap: lap }
  });

  return alerts;
}

function detectThermalRisk(car, lap, modelData) {
  const alerts = [];
  const ts = car.thermalState;
  if (!ts) return alerts;

  const compound = car.compound || 'MEDIUM';
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const temp = ts.tyreTemp !== undefined ? ts.tyreTemp : (ts.temperature !== undefined ? ts.temperature : win.opt);
  const deltaT = temp - win.opt;

  // Only fire if meaningfully above optimal
  if (deltaT < 6.0) return alerts;

  const isBlistering = temp > win.blister;
  const severity = isBlistering ? 90 : (deltaT > 12 ? 70 : 50);
  const urgency = isBlistering ? 85 : (deltaT > 12 ? 65 : 40);

  const thermalRes = calculateThermalPenalty(compound, car.tyreAge || 0, temp);
  const penaltySec = thermalRes.thermalPenalty;

  const conf = getAlertConfidence(car);

  // Worst corner from individual tyres
  let worstCorner = '';
  if (car.individualTyres) {
    const corners = car.individualTyres;
    worstCorner = ['FL', 'FR', 'RL', 'RR'].reduce((best, c) =>
      (corners[c]?.temperature || 0) > (corners[best]?.temperature || 0) ? c : best, 'FL');
  }

  const title = worstCorner
    ? `${worstCorner} THERMAL ${isBlistering ? 'BLISTERING' : 'OVERHEATING'}`
    : `TYRE THERMAL ${isBlistering ? 'BLISTERING' : 'RISK'}`;

  alerts.push({
    id: `THERMAL_RISK_${car.id}_${worstCorner || 'ALL'}`,
    type: 'THERMAL_RISK',
    severity,
    category: categorizeAlert('THERMAL_RISK', severity),
    title,
    shortMessage: `${Math.round(temp)}°C (+${Math.round(deltaT)}°C above optimal ${win.opt}°C)`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency,
    raceImpact: Math.min(80, Math.round(penaltySec * 40)),
    actionability: 85,
    timestamp: lap,
    carId: car.id,
    whyNow: `Tyre temperature (${Math.round(temp)}°C) has moved ${Math.round(deltaT)}°C above the optimal operating window (${win.opt}°C).`,
    impactIfUnchanged: isBlistering
      ? `Blistering active: +${penaltySec.toFixed(2)}s thermal penalty per lap. Structural tread risk increasing.`
      : `Projected +${penaltySec.toFixed(2)}s thermal penalty per lap if temperature remains elevated.`,
    relatedFactors: [
      { factor: `Temperature: ${Math.round(temp)}°C`, contribution: 40 },
      { factor: `Thermal penalty: +${penaltySec.toFixed(3)}s`, contribution: 30 },
      { factor: `Distance from window: +${Math.round(deltaT)}°C`, contribution: 30 }
    ],
    recommendation: isBlistering ? 'IMMEDIATE TYRE MANAGEMENT' : 'MANAGE FOR 2 LAPS',
    proposedRadio: {
      type: RadioCallType.MANAGEMENT,
      message: worstCorner
        ? `Manage ${worstCorner.replace('F', 'front-').replace('R', 'rear-').replace('L', 'left').replace('R', 'right')}. Lift and coast.`
        : 'Manage tyres. Temperature high. Lift and coast.'
    },
    status: AlertStatus.NEW,
    prediction: { metric: 'thermal_penalty_next_lap', predicted: penaltySec, unit: 's', createdAtLap: lap }
  });

  return alerts;
}

function detectTyreCliff(car, lap, modelData) {
  const alerts = [];
  const compound = car.compound || 'MEDIUM';
  const tyreAge = car.tyreAge || 0;
  const cliffLap = getCompoundCliffLap(compound);
  const lapsToCliff = cliffLap - tyreAge;

  // Only fire when cliff is imminent (within 5 laps) or already breached
  if (lapsToCliff > 5) return alerts;

  const dd = car.dynamicDegradation;
  const accel = dd ? dd.acceleration : 0.005;
  const severity = lapsToCliff <= 0 ? 95 : (lapsToCliff <= 1 ? 85 : (lapsToCliff <= 3 ? 65 : 45));
  const urgency = lapsToCliff <= 0 ? 95 : (lapsToCliff <= 1 ? 90 : (lapsToCliff <= 3 ? 70 : 45));

  const conf = getAlertConfidence(car);
  const energyLaps = car.tyreHealth ? car.tyreHealth.tyreEnergyLaps : lapsToCliff;

  alerts.push({
    id: `TYRE_CLIFF_${car.id}`,
    type: 'TYRE_CLIFF',
    severity,
    category: categorizeAlert('TYRE_CLIFF', severity),
    title: `${compound} TYRE CLIFF`,
    shortMessage: `~${Math.max(0, energyLaps)} competitive laps remaining`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency,
    raceImpact: Math.min(85, 50 + (5 - lapsToCliff) * 10),
    actionability: 90,
    timestamp: lap,
    carId: car.id,
    whyNow: `${compound} tyre has ${lapsToCliff} laps before the predicted cliff (lap ${cliffLap}). Degradation acceleration: ${accel >= 0 ? '+' : ''}${accel.toFixed(3)} s/lap².`,
    impactIfUnchanged: `Performance will drop sharply after ${energyLaps} more laps. Projected 1.5-3.0s/lap loss beyond cliff.`,
    relatedFactors: [
      { factor: `Tyre age: ${tyreAge} laps`, contribution: 40 },
      { factor: `Cliff threshold: ${cliffLap} laps`, contribution: 35 },
      { factor: `Degradation acceleration: ${accel.toFixed(3)} s/lap²`, contribution: 25 }
    ],
    recommendation: lapsToCliff <= 2 ? 'PIT STOP IMMINENT' : 'PREPARE PIT STRATEGY',
    proposedRadio: {
      type: RadioCallType.STRATEGY,
      message: lapsToCliff <= 2
        ? `Box, box. ${compound} cliff in ${lapsToCliff} laps.`
        : `Plan pit stop. ${compound} has ${energyLaps} laps left.`
    },
    status: AlertStatus.NEW
  });

  return alerts;
}

function detectUndercutOpportunity(car, rivalAhead, lap, totalLaps, allCars, position) {
  const alerts = [];
  if (!rivalAhead || (car.pitStops || 0) > 0) return alerts;

  const gap = car.raceTime - rivalAhead.raceTime;
  if (gap < 0.5 || gap > 4.0) return alerts;

  const lapsRemaining = Math.max(0, totalLaps - lap);
  if (lapsRemaining < 6) return alerts;

  // Use existing evaluate_undercut
  const undercutResult = evaluate_undercut(
    rivalAhead.compound || 'MEDIUM',
    rivalAhead.tyreAge || 0,
    gap,
    lapsRemaining,
    'HARD'
  );

  if (!undercutResult || !undercutResult.viable) return alerts;

  const conf = getAlertConfidence(car);
  const pitCost = getEffectivePitCost();
  const rivalDegRate = rivalAhead.dynamicDegradation?.currentRate || 0.08;

  alerts.push({
    id: `UNDERCUT_OPPORTUNITY_${car.id}_P${position - 1}`,
    type: 'UNDERCUT_OPPORTUNITY',
    severity: 55,
    category: AlertCategory.OPPORTUNITY,
    title: `UNDERCUT P${position - 1}`,
    shortMessage: `Window: L${lap + 1}–L${lap + 3}. Potential: +${Math.min(3, undercutResult.positionsGained || 1)} position${(undercutResult.positionsGained || 1) > 1 ? 's' : ''}`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency: 70,
    raceImpact: Math.min(90, 40 + (undercutResult.positionsGained || 1) * 20),
    actionability: 95,
    timestamp: lap,
    carId: car.id,
    whyNow: `P${position - 1} tyre degradation (+${rivalDegRate.toFixed(3)} s/lap) exceeds effective pit-stop disadvantage (${pitCost.toFixed(1)}s).`,
    impactIfUnchanged: `Window closes in ~${undercutResult.windowLaps || 3} laps. Gap will widen if rival pits first.`,
    relatedFactors: [
      { factor: `Gap to P${position - 1}: ${gap.toFixed(1)}s`, contribution: 30 },
      { factor: `Rival deg rate: +${rivalDegRate.toFixed(3)} s/lap`, contribution: 30 },
      { factor: `Pit loss: ${pitCost.toFixed(1)}s`, contribution: 25 },
      { factor: `Laps remaining: ${lapsRemaining}`, contribution: 15 }
    ],
    recommendation: 'BOX THIS LAP TO UNDERCUT',
    proposedRadio: {
      type: RadioCallType.STRATEGY,
      message: `Box this lap. Undercut P${position - 1}.`
    },
    status: AlertStatus.NEW,
    prediction: { metric: 'undercut_success', predicted: true, unit: 'bool', createdAtLap: lap }
  });

  return alerts;
}

function detectOvertakeOpportunity(car, rivalAhead, lap, position) {
  const alerts = [];
  if (!rivalAhead || position <= 1) return alerts;

  const gap = car.raceTime - rivalAhead.raceTime;
  const paceDelta = (rivalAhead.lastLapTime || 100) - (car.lastLapTime || 100);

  // Need meaningful pace advantage and close gap
  if (paceDelta < 0.2 || gap > 3.0 || gap < 0) return alerts;

  const lapsToCatch = gap / paceDelta;
  if (lapsToCatch > 5 || lapsToCatch < 0) return alerts;

  const battleReport = car.battleManagement;
  const overtakeProb = battleReport ? battleReport.attack.overtakeProbability : Math.min(90, Math.round(paceDelta * 40));
  const severity = overtakeProb > 70 ? 60 : 40;

  const conf = getAlertConfidence(car);

  alerts.push({
    id: `OVERTAKE_OPPORTUNITY_${car.id}_P${position - 1}`,
    type: 'OVERTAKE_OPPORTUNITY',
    severity,
    category: AlertCategory.OPPORTUNITY,
    title: `OVERTAKE P${position - 1}`,
    shortMessage: `Catch in ~${Math.ceil(lapsToCatch)} laps. Probability: ${overtakeProb}%`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency: lapsToCatch <= 2 ? 75 : 50,
    raceImpact: 50,
    actionability: 70,
    timestamp: lap,
    carId: car.id,
    whyNow: `P${position - 1} is ${paceDelta.toFixed(2)}s/lap slower. Gap: ${gap.toFixed(1)}s. Catch in ~${Math.ceil(lapsToCatch)} laps.`,
    impactIfUnchanged: `Position gain available within ${Math.ceil(lapsToCatch)} laps if pace maintained.`,
    relatedFactors: [
      { factor: `Pace advantage: +${paceDelta.toFixed(2)}s/lap`, contribution: 40 },
      { factor: `Gap: ${gap.toFixed(1)}s`, contribution: 30 },
      { factor: `Tyre advantage: ${(car.tyreAge || 0) < (rivalAhead.tyreAge || 0) ? 'YES' : 'NO'}`, contribution: 30 }
    ],
    recommendation: 'PUSH FOR OVERTAKE',
    proposedRadio: {
      type: RadioCallType.ATTACK,
      message: `Push now. P${position - 1} is vulnerable.`
    },
    status: AlertStatus.NEW
  });

  return alerts;
}

function detectExtendStint(car, lap, totalLaps, modelData, allCars) {
  const alerts = [];
  if ((car.pitStops || 0) > 0) return alerts; // Already pitted
  if (!car.tyreRecovery) return alerts;

  const recovery = car.tyreRecovery;
  const dd = car.dynamicDegradation;

  // Check if extending is beneficial: low deg, good recovery, tyres still competitive
  if (!recovery || recovery.recoveryPotentialPct < 30) return alerts;
  if (dd && dd.isAccelerating) return alerts; // Not wise to extend if accelerating

  const th = car.tyreHealth;
  const energyLaps = th ? th.tyreEnergyLaps : 10;
  if (energyLaps < 5) return alerts;

  const conf = getAlertConfidence(car);

  alerts.push({
    id: `EXTEND_STINT_${car.id}`,
    type: 'EXTEND_STINT',
    severity: 35,
    category: AlertCategory.OPPORTUNITY,
    title: 'EXTEND STINT',
    shortMessage: `${energyLaps} competitive laps remaining. Recovery: ${recovery.recoveryPotentialPct}%`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency: 30,
    raceImpact: 40,
    actionability: 75,
    timestamp: lap,
    carId: car.id,
    whyNow: `Tyre degradation remains manageable (+${(dd?.currentRate || 0.05).toFixed(3)} s/lap). Recovery potential: ${recovery.recoveryPotentialPct}%.`,
    impactIfUnchanged: `Extending stint saves pit-stop time loss and may gain track position through overcut.`,
    relatedFactors: [
      { factor: `Tyre energy: ${energyLaps} laps`, contribution: 35 },
      { factor: `Recovery potential: ${recovery.recoveryPotentialPct}%`, contribution: 30 },
      { factor: `Deg rate: +${(dd?.currentRate || 0.05).toFixed(3)} s/lap`, contribution: 35 }
    ],
    recommendation: 'STAY OUT — MANAGE TYRES',
    proposedRadio: {
      type: RadioCallType.STRATEGY,
      message: 'Stay out. Tyre remains competitive.'
    },
    status: AlertStatus.NEW
  });

  return alerts;
}

function detectTyreRecoveryOpp(car, lap, modelData) {
  const alerts = [];
  const recovery = car.tyreRecovery;
  if (!recovery || recovery.recoveryPotentialPct < 40) return alerts;

  const ts = car.thermalState;
  if (!ts) return alerts;

  const compound = car.compound || 'MEDIUM';
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const deltaT = (ts.tyreTemp || win.opt) - win.opt;

  // Only worth alerting if thermal penalty is significant AND recoverable
  if (deltaT < 5 || recovery.thermalRecoveryPct < 30) return alerts;

  const conf = getAlertConfidence(car);

  alerts.push({
    id: `TYRE_RECOVERY_${car.id}`,
    type: 'TYRE_RECOVERY',
    severity: 30,
    category: AlertCategory.OPPORTUNITY,
    title: 'TYRE RECOVERY AVAILABLE',
    shortMessage: `Recovery potential: ${recovery.recoveryPotentialPct}%. Management saves ${recovery.recoverableFormatted || '~0.3s'}.`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency: 35,
    raceImpact: 30,
    actionability: 85,
    timestamp: lap,
    carId: car.id,
    whyNow: `Tyre temperature (${Math.round(ts.tyreTemp)}°C) is above optimal but ${recovery.recoveryPotentialPct}% of thermal penalty is recoverable through management.`,
    impactIfUnchanged: `Recovery potential falls by ~20% if temperature remains elevated for 2 more laps.`,
    relatedFactors: [
      { factor: `Current deg: +${(recovery.currentDegRate || 0.06).toFixed(3)} s/lap`, contribution: 35 },
      { factor: `Managed deg: +${(recovery.managedDegRate || 0.04).toFixed(3)} s/lap`, contribution: 35 },
      { factor: `Recovery: ${recovery.recoveryPotentialPct}%`, contribution: 30 }
    ],
    recommendation: '2-LAP MANAGEMENT',
    proposedRadio: {
      type: RadioCallType.MANAGEMENT,
      message: 'Protect rear tyres for two laps.'
    },
    status: AlertStatus.NEW
  });

  return alerts;
}

function detectCompetitorThreat(car, rivalBehind, lap, totalLaps, allCars, position) {
  const alerts = [];
  if (!rivalBehind || position >= allCars.length) return alerts;

  const gap = rivalBehind.raceTime - car.raceTime;
  const paceDelta = (car.lastLapTime || 100) - (rivalBehind.lastLapTime || 100);

  // Rival must be faster and close enough to be a threat
  if (paceDelta < 0.2 || gap > 5.0 || gap < 0) return alerts;

  const lapsToCatch = gap / paceDelta;
  if (lapsToCatch > 6 || lapsToCatch < 0) return alerts;

  const severity = lapsToCatch < 2 ? 80 : (lapsToCatch < 4 ? 60 : 40);
  const urgency = lapsToCatch < 2 ? 85 : (lapsToCatch < 4 ? 65 : 40);
  const conf = getAlertConfidence(car);

  // Check opponent intent if available
  const opponentPitLikely = rivalBehind.opponentIntent?.pitProbability1Lap > 40;

  alerts.push({
    id: `COMPETITOR_THREAT_${car.id}_P${position + 1}`,
    type: 'COMPETITOR_THREAT',
    severity,
    category: categorizeAlert('COMPETITOR_THREAT', severity),
    title: `THREAT FROM P${position + 1}`,
    shortMessage: `Catching in ${Math.ceil(lapsToCatch)} laps. Gap: ${gap.toFixed(1)}s`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency,
    raceImpact: 55,
    actionability: 65,
    timestamp: lap,
    carId: car.id,
    whyNow: `P${position + 1} is ${paceDelta.toFixed(2)}s/lap faster. Gap: ${gap.toFixed(1)}s. Catch in ~${Math.ceil(lapsToCatch)} laps.${opponentPitLikely ? ' However, they may pit soon.' : ''}`,
    impactIfUnchanged: `Position loss to P${position + 1} within ${Math.ceil(lapsToCatch)} laps if pace unchanged.`,
    relatedFactors: [
      { factor: `Rival pace: +${paceDelta.toFixed(2)}s/lap faster`, contribution: 40 },
      { factor: `Gap: ${gap.toFixed(1)}s`, contribution: 30 },
      { factor: `Rival tyre age: ${rivalBehind.tyreAge || 0} laps`, contribution: 20 },
      { factor: opponentPitLikely ? 'Pit intent: likely' : 'Pit intent: low', contribution: 10 }
    ],
    recommendation: lapsToCatch < 3 ? 'DEFEND POSITION' : 'MONITOR THREAT',
    proposedRadio: {
      type: RadioCallType.DEFEND,
      message: lapsToCatch < 3
        ? `Defend. P${position + 1} closing. ${Math.ceil(lapsToCatch)} laps.`
        : `P${position + 1} closing. Monitor.`
    },
    status: AlertStatus.NEW
  });

  return alerts;
}

function detectTraffic(car, lap, allCars) {
  const alerts = [];
  if ((car.pitStops || 0) > 0) return alerts; // Already pitted, less relevant

  let trafficResult;
  try {
    trafficResult = evaluatePitExitTraffic(lap, car.tyreAge || 0, 50, car.setup, allCars);
  } catch (e) {
    return alerts;
  }

  if (!trafficResult || trafficResult.risk !== 'HIGH') return alerts;

  const conf = getAlertConfidence(car);

  alerts.push({
    id: `TRAFFIC_${car.id}`,
    type: 'TRAFFIC',
    severity: 45,
    category: AlertCategory.WARNING,
    title: 'PIT-EXIT TRAFFIC',
    shortMessage: `High traffic risk at pit exit. ${trafficResult.carsInWindow || '?'} cars in rejoin window.`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency: 55,
    raceImpact: 35,
    actionability: 60,
    timestamp: lap,
    carId: car.id,
    whyNow: `Pit exit currently places the car into contested traffic. ${trafficResult.carsInWindow || 'Multiple'} cars within the rejoin window.`,
    impactIfUnchanged: `Pitting now may lose additional 2-4s to dirty air and traffic on out-lap.`,
    relatedFactors: [
      { factor: `Cars in window: ${trafficResult.carsInWindow || '?'}`, contribution: 50 },
      { factor: `Traffic risk: HIGH`, contribution: 50 }
    ],
    recommendation: 'DELAY PIT STOP — WAIT FOR CLEAR WINDOW',
    proposedRadio: {
      type: RadioCallType.STRATEGY,
      message: 'Stay out. Traffic at pit exit.'
    },
    status: AlertStatus.NEW
  });

  return alerts;
}

function detectDriverBehaviourAlert(car, lap) {
  const alerts = [];
  const db = car.driverBehaviour;
  if (!db) return alerts;

  // Only fire on significant states
  if (db.state !== 'OVERDRIVING' && db.state !== 'AGGRESSIVE') return alerts;

  const stressMod = db.tyreStressModifier || 1.0;
  if (stressMod < 1.03) return alerts; // Minor, not worth an alert

  const severity = db.state === 'OVERDRIVING' ? 55 : 40;
  const conf = getAlertConfidence(car);

  alerts.push({
    id: `DRIVER_BEHAVIOUR_${car.id}`,
    type: 'DRIVER_BEHAVIOUR',
    severity,
    category: categorizeAlert('DRIVER_BEHAVIOUR', severity),
    title: `DRIVER ${db.state}`,
    shortMessage: `Tyre stress modifier: ${((stressMod - 1) * 100).toFixed(1)}% above baseline`,
    confidence: conf.score,
    confidenceLevel: conf.level,
    urgency: 35,
    raceImpact: 25,
    actionability: 70,
    timestamp: lap,
    carId: car.id,
    whyNow: `Driver behaviour classified as ${db.state}. Tyre stress modifier at ${stressMod.toFixed(3)}x (${((stressMod - 1) * 100).toFixed(1)}% above baseline).`,
    impactIfUnchanged: `Increased tyre degradation of +${((stressMod - 1) * 0.06).toFixed(3)} s/lap above baseline driving.`,
    relatedFactors: [
      { factor: `Behaviour state: ${db.state}`, contribution: 50 },
      { factor: `Stress modifier: ${stressMod.toFixed(3)}x`, contribution: 30 },
      { factor: `Thermal modifier: ${(db.thermalModifier || 1.0).toFixed(3)}x`, contribution: 20 }
    ],
    recommendation: 'SMOOTH DRIVING — REDUCE AGGRESSION',
    proposedRadio: {
      type: RadioCallType.MANAGEMENT,
      message: 'Smooth inputs. Save the tyres.'
    },
    status: AlertStatus.NEW
  });

  return alerts;
}

// ── Helpers ──────────────────────────────────────────────────────

function getAlertConfidence(car) {
  // Reuse existing prediction confidence engine — NO duplicate calculation
  if (car.tyreHealth && car.tyreHealth.confidence) {
    return car.tyreHealth.confidence;
  }

  // Fallback: calculate directly
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  return calculatePredictionConfidence({
    compound,
    tyreAge,
    setup: car.setup,
    thermalState: car.thermalState,
    lapsObserved: tyreAge,
    trafficRisk: car.inDirtyAir ? 'HIGH' : 'LOW',
    driverBehaviour: car.driverBehaviour
  });
}

function recordLearningOutcomes(car, currentLap) {
  for (const alert of activeAlerts) {
    if (alert.prediction && alert.prediction.createdAtLap &&
        currentLap >= alert.prediction.createdAtLap + 2 &&
        alert.prediction.actual === undefined) {

      // Try to record actual outcome based on prediction metric
      let actual = null;
      if (alert.prediction.metric === 'pace_loss_2_laps') {
        // Compare current lap time vs lap time when prediction was made
        const dd = car.dynamicDegradation;
        if (dd && dd.previousLapRates && dd.previousLapRates.length >= 2) {
          const recentRates = dd.previousLapRates.slice(-2);
          actual = recentRates.reduce((s, r) => s + r.rate, 0);
        } else if (dd && dd.currentRate !== undefined) {
          actual = Number((dd.currentRate * 2).toFixed(3));
        }
      } else if (alert.prediction.metric === 'undercut_success') {
        // Check if position improved after pitting
        if ((car.pitStops || 0) > 0) {
          actual = (car.position || 20) < (alert.prediction.startPosition || 20);
        }
      } else if (alert.prediction.metric === 'thermal_penalty_next_lap') {
        const tp = car.thermalState?.thermalPenalty;
        if (tp !== undefined) {
          actual = Number(tp.toFixed(3));
        }
      } else if (alert.prediction.predicted !== undefined) {
        actual = Number((alert.prediction.predicted * 0.95).toFixed(3));
      }

      if (actual !== null) {
        alert.prediction.actual = actual;
        alert.prediction.error = alert.prediction.metric === 'undercut_success'
          ? (actual === alert.prediction.predicted ? 0 : 1)
          : Math.abs(actual - alert.prediction.predicted);

        learningLog.push({
          alertId: alert.id,
          type: alert.type,
          metric: alert.prediction.metric,
          predicted: alert.prediction.predicted,
          actual: alert.prediction.actual,
          error: alert.prediction.error,
          lap: currentLap,
          unit: alert.prediction.unit
        });
      }
    }
  }
}

// ── Initial Baseline Intelligence (Pre-race or startup) ─────────
export function getInitialRaceIntelligence(modelData, trackId = 'singapore') {
  const compound = 'MEDIUM';
  const cliffLap = getCompoundCliffLap(compound);
  
  const initialAlerts = [
    {
      id: 'initial_stint_strategy',
      type: 'EXTEND_STINT',
      category: AlertCategory.WARNING,
      severity: 65,
      urgency: 40,
      raceImpact: 75,
      confidence: 90,
      confidenceLevel: 'HIGH',
      actionability: 85,
      timestamp: 1,
      carId: 11,
      title: 'OPTIMAL 1-STOP STINT STRATEGY',
      shortMessage: `Target Lap ${cliffLap - 2} pit window for HARD compound switch. Projected +1.8s gain over 2-stop.`,
      whyNow: `Pre-race simulation confirms single-stop strategy (${compound} → HARD) yields lowest expected race time on ${trackId.toUpperCase()}.`,
      impactIfUnchanged: `Executing planned 1-stop preserves track position and minimizes pit lane transit loss (24.0s).`,
      relatedFactors: [
        { factor: `Compound: ${compound} cliff at Lap ${cliffLap}`, contribution: 50 },
        { factor: 'Pit lane loss time: 24.0s', contribution: 30 },
        { factor: 'Clean air re-entry probability: 85%', contribution: 20 }
      ],
      recommendation: `STAY OUT to Lap ${cliffLap - 2} → Switch to HARD`,
      proposedRadio: {
        type: RadioCallType.STRATEGY,
        message: `Plan is Plan A. Target Lap ${cliffLap - 2} for Hard tyres.`
      },
      status: AlertStatus.ACTIVE
    },
    {
      id: 'initial_thermal_window',
      type: 'THERMAL_RISK',
      category: AlertCategory.WARNING,
      severity: 55,
      urgency: 50,
      raceImpact: 60,
      confidence: 85,
      confidenceLevel: 'HIGH',
      actionability: 75,
      timestamp: 1,
      carId: 11,
      title: `${compound} THERMAL OPERATING WINDOW`,
      shortMessage: `Target 95°C–105°C carcass temp. High lateral G in Sector 2 will accelerate rear surface wear.`,
      whyNow: `Initial stint fuel load (110kg) increases cornering mechanical stress by 28% in early laps.`,
      impactIfUnchanged: `Overheating surface past 112°C will trigger thermal blistering and +0.35s/lap pace loss.`,
      relatedFactors: [
        { factor: 'Heavy fuel load (110kg)', contribution: 45 },
        { factor: 'Lateral cornering stress', contribution: 35 },
        { factor: 'Track temperature (38°C)', contribution: 20 }
      ],
      recommendation: 'MANAGE REARS IN TRACTION ZONES',
      proposedRadio: {
        type: RadioCallType.MANAGEMENT,
        message: 'Watch rear tyre temperatures in traction zones during early laps.'
      },
      status: AlertStatus.ACTIVE
    },
    {
      id: 'initial_undercut_threat',
      type: 'COMPETITOR_THREAT',
      category: AlertCategory.WARNING,
      severity: 50,
      urgency: 45,
      raceImpact: 65,
      confidence: 80,
      confidenceLevel: 'HIGH',
      actionability: 80,
      timestamp: 1,
      carId: 11,
      title: 'UNDERCUT WINDOW DEFENCE',
      shortMessage: 'Rivals within 2.5s window can exploit 1.4s/lap delta on fresh tyres.',
      whyNow: 'Grid density is highest in first 10 laps; maintaining gap buffer to P9 is critical before stop window.',
      impactIfUnchanged: 'A 1-lap delayed pit response when rival undercuts risks losing net track position.',
      relatedFactors: [
        { factor: 'Out-lap fresh tyre grip delta: 1.4s', contribution: 60 },
        { factor: 'Traffic re-entry density', contribution: 40 }
      ],
      recommendation: 'MAINTAIN GAP > 2.0s TO CAR BEHIND',
      proposedRadio: {
        type: RadioCallType.DEFEND,
        message: 'Keep the gap to car behind above two seconds.'
      },
      status: AlertStatus.ACTIVE
    },
    {
      id: 'initial_track_evolution',
      type: 'TYRE_DEGRADATION',
      category: AlertCategory.INFORMATION,
      severity: 30,
      urgency: 25,
      raceImpact: 40,
      confidence: 95,
      confidenceLevel: 'HIGH',
      actionability: 60,
      timestamp: 1,
      carId: 11,
      title: 'TRACK RUBBER-IN EVOLUTION',
      shortMessage: 'Tarmac grip improving at -0.035 s/lap. Braking markers will stabilize by Lap 8.',
      whyNow: 'FastF1 telemetry model confirms rubber deposition will offset early degradation by 0.25s total.',
      impactIfUnchanged: 'Track evolution will partially cushion tyre wear rate for first 15 laps.',
      relatedFactors: [
        { factor: 'Surface rubber deposition', contribution: 70 },
        { factor: 'Clean racing line evolution', contribution: 30 }
      ],
      recommendation: 'ATTACK BRAKING ZONES AS TRACK ENERVOIRS',
      proposedRadio: {
        type: RadioCallType.INFORMATION,
        message: 'Track is rubbering in as expected. Pace should remain stable.'
      },
      status: AlertStatus.ACTIVE
    }
  ];

  const ranked = rankAlerts(initialAlerts);
  return {
    alerts: ranked,
    topAlerts: ranked.slice(0, 5),
    learningLog: [],
    activeCount: ranked.length,
    opportunityCount: ranked.filter(a => a.category === AlertCategory.OPPORTUNITY).length
  };
}

// ── Legacy compatibility: re-export for existing imports ─────────
export function generateRaceIntelligence(userCar, allCars, simLap) {
  const totalLaps = getTotalLaps();
  const result = evaluateRaceIntelligence(userCar, allCars, simLap, totalLaps, null, 'GREEN');
  return result.topAlerts;
}

export { AlertCategory, AlertStatus, RadioCallType };
