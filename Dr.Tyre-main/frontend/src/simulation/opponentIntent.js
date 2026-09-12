/**
 * opponentIntent.js — Opponent Intent Prediction & Strategic Response Engine
 * 
 * Estimates future pit probabilities (Next 1, 2, 3 laps) for any competitor
 * using dynamic telemetry, degradation slope, cliff proximity, and traffic.
 * 
 * Computes human-readable intent reasoning and our tactical response:
 *   - COVER
 *   - IGNORE
 *   - RESPOND
 *   - UNDERCUT
 *   - EXTEND
 *   - PIT OPPOSITE
 */

import { getMarginalDegRate, getPrescription, getCompoundCliffLap, getDegradationDelta, COMPOUND_THERMAL_WINDOWS } from './strategy.js';

/**
 * Evaluates opponent intent and our strategic response for a competitor car.
 * 
 * @param {Object} competitorCar - Competitor car object
 * @param {Object} userCar - User car object
 * @param {number} currentLap - Current race lap
 * @param {number} totalLaps - Total race laps
 * @param {Array} allCars - All 20 race cars
 * @param {Object|null} modelData - Authoritative ML pipeline model data
 * @returns {Object} Opponent intent analysis & tactical response
 */
export function evaluateOpponentIntent(competitorCar, userCar, currentLap, totalLaps, allCars = [], modelData = null) {
  const compound = competitorCar.compound || 'MEDIUM';
  const tyreAge = Math.max(0, competitorCar.tyreAge || 0);
  const setup = competitorCar.setup || null;
  const thermalState = competitorCar.thermalState || { tyreTemp: 100, optimalTemp: 100 };
  const pitStops = competitorCar.pitStops || 0;
  const lapsRemaining = Math.max(0, totalLaps - currentLap);
  const cliffLap = getCompoundCliffLap(compound);

  // 1. Recalculate authoritative prescription specifically for this competitor
  const compRx = getPrescription(
    compound,
    tyreAge,
    currentLap,
    competitorCar.fuelPct,
    setup,
    allCars,
    thermalState,
    pitStops,
    competitorCar.driverBehaviour
  );

  // Extract optimal pit lap
  let optimalPitLap = currentLap + 5;
  if (compRx.optimalLap && !isNaN(Number(compRx.optimalLap))) {
    optimalPitLap = Number(compRx.optimalLap);
  } else if (compRx.optimalLap === 'RACE FINISH') {
    optimalPitLap = totalLaps;
  }

  const lapsUntilOptimal = Math.max(0, optimalPitLap - currentLap);
  const isCliffImminent = tyreAge >= cliffLap - 2;
  const degRate = getMarginalDegRate(compound, tyreAge, setup);
  const degAccel = competitorCar.dynamicDegradationState?.acceleration || 0.005;
  const isOverheating = thermalState.tyreTemp > (COMPOUND_THERMAL_WINDOWS[compound]?.opt || 100) + 7;

  // ─────────────────────────────────────────────────────────────
  // 2. FUTURE PIT INTENT PROBABILITIES (Next 1, 2, 3 Laps)
  // ─────────────────────────────────────────────────────────────
  let p1 = 0;
  let p2 = 0;
  let p3 = 0;

  if (pitStops >= 1 && optimalPitLap === totalLaps) {
    // 1-stop strategy already completed, running to finish
    p1 = 3;
    p2 = 5;
    p3 = 8;
  } else if (compRx.action === 'PIT NOW' || compRx.action.includes('PIT')) {
    // Prescribed pit stop is right now
    p1 = 88;
    p2 = 96;
    p3 = 99;
  } else if (lapsUntilOptimal <= 1) {
    p1 = 58;
    p2 = 86;
    p3 = 95;
  } else if (lapsUntilOptimal <= 2) {
    p1 = 28;
    p2 = 68;
    p3 = 89;
  } else if (lapsUntilOptimal <= 3) {
    p1 = 14;
    p2 = 42;
    p3 = 78;
  } else if (lapsUntilOptimal <= 5) {
    p1 = 8;
    p2 = 22;
    p3 = 48;
  } else {
    p1 = 4;
    p2 = 10;
    p3 = 20;
  }

  // Adjust for critical tyre distress (thermal or degradation cliff)
  if (isCliffImminent) {
    p1 = Math.min(98, p1 + 25);
    p2 = Math.min(99, p2 + 20);
    p3 = Math.min(99, p3 + 10);
  }
  if (isOverheating) {
    p1 = Math.min(98, p1 + 15);
    p2 = Math.min(99, p2 + 15);
  }

  // Clamping
  p1 = Math.min(99, Math.max(2, Math.round(p1)));
  p2 = Math.min(99, Math.max(p1, Math.round(p2)));
  p3 = Math.min(99, Math.max(p2, Math.round(p3)));

  // Confidence score for optimal pit calculation
  const confidenceScore = compRx.strategyConfidence === 'HIGH' ? 88 : compRx.strategyConfidence === 'MEDIUM' ? 76 : 64;

  // ─────────────────────────────────────────────────────────────
  // 3. DYNAMIC "WHY IS THIS OPTIMAL?" EXPLANATION BULLETS
  // ─────────────────────────────────────────────────────────────
  const whyBullets = [];
  const primaryTarget = (compound === 'HARD') ? 'MEDIUM' : 'HARD';
  const paceLoss = getDegradationDelta(compound, tyreAge, setup, thermalState);

  if (degAccel > 0.008) {
    whyBullets.push(`Tyre degradation is accelerating at +${degAccel.toFixed(3)} s/lap².`);
  }
  if (tyreAge >= cliffLap - 3) {
    whyBullets.push(`Tyre age (${tyreAge} laps) is approaching the ${compound} degradation cliff (${cliffLap} laps).`);
  } else {
    whyBullets.push(`Current tyre life (${tyreAge} laps) has consumed usable peak grip.`);
  }

  const freshTyrePaceDelta = Math.max(0.4, (paceLoss - 0.15));
  whyBullets.push(`Fresh ${primaryTarget} tyre projected to recover ~${freshTyrePaceDelta.toFixed(2)}s per lap.`);

  if (compRx.trafficRisk === 'LOW') {
    whyBullets.push('Pit exit traffic window is clear (clean air projected on rejoin).');
  } else {
    whyBullets.push(`Pit exit re-joins near traffic packet (${compRx.trafficDetails || 'contested'}).`);
  }

  if (optimalPitLap <= currentLap + 2) {
    whyBullets.push(`Staying out beyond Lap ${optimalPitLap} becomes net slower across full race distance.`);
  } else {
    whyBullets.push(`Continuing stint until Lap ${optimalPitLap} maximizes total race time efficiency.`);
  }

  // ─────────────────────────────────────────────────────────────
  // 4. HUMAN-READABLE INTENT REASONING
  // ─────────────────────────────────────────────────────────────
  let intentReasoning = '';
  const carName = competitorCar.isUser ? 'Your car' : `Car ${competitorCar.number || competitorCar.driverName || 'AI'}`;

  if (p2 >= 65) {
    intentReasoning = `${carName} is highly likely to pit soon (${p2}% within 2 laps) because its ${compound} tyre degradation has accelerated (+${degRate.toFixed(3)} s/lap) while staying out exceeds pit-lane delta cost.`;
  } else if (pitStops >= 1 && optimalPitLap === totalLaps) {
    intentReasoning = `${carName} has completed its mandatory stop and is managing its ${compound} tyres to reach the chequered flag.`;
  } else {
    intentReasoning = `${carName} is unlikely to pit immediately (${p1}% next lap) because current tyre pace remains competitive (+${paceLoss.toFixed(2)}s loss) and extending protects track position.`;
  }

  // ─────────────────────────────────────────────────────────────
  // 5. OUR TACTICAL RESPONSE: COVER / IGNORE / RESPOND / UNDERCUT / EXTEND / PIT OPPOSITE
  // ─────────────────────────────────────────────────────────────
  let ourResponse = 'IGNORE';
  let responseReason = 'No immediate tactical battle with this competitor.';
  let responseBadgeClass = 'badge-ignore';

  if (!userCar) {
    ourResponse = 'MONITOR';
    responseReason = 'Evaluating grid tyre evolution.';
    responseBadgeClass = 'badge-ignore';
  } else {
    const userCompound = userCar.compound || 'MEDIUM';
    const userAge = Math.max(0, userCar.tyreAge || 0);
    const userDegRate = getMarginalDegRate(userCompound, userAge, userCar.setup);
    
    // Relative track position & gap
    const compPos = competitorCar.position || 10;
    const userPos = userCar.position || 10;
    const posDiff = compPos - userPos; // Negative if competitor is ahead of user

    // Gap estimation: ~1.5s per position diff if telemetry gap is missing
    const gapSeconds = (competitorCar.gapToUser !== undefined)
      ? Math.abs(competitorCar.gapToUser)
      : Math.abs(posDiff) * 1.6;

    if (Math.abs(posDiff) > 4 || gapSeconds > 12.0) {
      // Competitor is too far away to influence our immediate tactical decisions
      ourResponse = 'IGNORE';
      responseReason = `${carName} is ${gapSeconds.toFixed(1)}s away in P${compPos}; no immediate tactical overlap.`;
      responseBadgeClass = 'badge-ignore';
    } else if (posDiff === -1 || (posDiff < 0 && gapSeconds <= 3.5)) {
      // Competitor is directly ahead within our undercut window!
      if (p2 >= 60) {
        ourResponse = 'UNDERCUT';
        responseReason = `${carName} ahead has a ${p2}% pit intent in 2 laps. Box 1 lap earlier to jump track position via fresh tyre out-lap.`;
        responseBadgeClass = 'badge-undercut';
      } else if (userDegRate < degRate - 0.02) {
        ourResponse = 'EXTEND';
        responseReason = `Our tyre degradation (+${userDegRate.toFixed(3)}s/L) is better than ${carName} (+${degRate.toFixed(3)}s/L). Extend stint to build overcut gap.`;
        responseBadgeClass = 'badge-extend';
      } else {
        ourResponse = 'RESPOND';
        responseReason = `Stay within 1.5s striking distance and react when ${carName} triggers pit entry.`;
        responseBadgeClass = 'badge-respond';
      }
    } else if (posDiff === 1 || (posDiff > 0 && gapSeconds <= 3.5)) {
      // Competitor is directly behind us threatening an undercut!
      if (p2 >= 55) {
        ourResponse = 'COVER';
        responseReason = `If ${carName} pits within 2 laps (${p2}% probability), box next lap to neutralize their undercut attempt.`;
        responseBadgeClass = 'badge-cover';
      } else {
        ourResponse = 'EXTEND';
        responseReason = `Maintain pace and control race tempo; ${carName} is not in immediate stop window.`;
        responseBadgeClass = 'badge-extend';
      }
    } else if (gapSeconds <= 6.0 && competitorCar.compound !== userCar.compound) {
      ourResponse = 'PIT OPPOSITE';
      responseReason = `${carName} is on alternate compound (${compound}). Pitting opposite creates offset tyre delta for late-race attack.`;
      responseBadgeClass = 'badge-opposite';
    } else {
      ourResponse = 'MONITOR';
      responseReason = `Track ${carName} pit delta window against our scheduled stop on Lap ${userCar.optimalPitLap || 28}.`;
      responseBadgeClass = 'badge-ignore';
    }
  }

  return {
    competitor: {
      carNumber: competitorCar.number,
      driverName: competitorCar.driverName || `AI #${competitorCar.number}`,
      team: competitorCar.team || 'Rival Team',
      position: competitorCar.position,
      compound,
      tyreAge,
      degRate,
      tyreTemp: Math.round(thermalState.tyreTemp),
      paceLoss
    },
    prescription: {
      action: compRx.action,
      nextBestAction: compRx.recommendedAction || compRx.action,
      optimalPitLap,
      confidenceScore,
      whyBullets
    },
    intent: {
      p1,
      p2,
      p3,
      intentReasoning
    },
    tacticalResponse: {
      action: ourResponse,
      reason: responseReason,
      badgeClass: responseBadgeClass
    }
  };
}
