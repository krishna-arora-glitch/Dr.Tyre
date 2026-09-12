/**
 * opportunityDetector.js — Race Event Opportunity Detector
 * 
 * Continuously evaluates measurable telemetry, competitor states, and pit windows
 * to detect tactical opportunities:
 * - UNDERCUT OPPORTUNITY
 * - EXTEND STINT OPPORTUNITY
 * - TYRE RECOVERY OPPORTUNITY
 * - OVERTAKE OPPORTUNITY
 * - COMPETITOR DEGRADATION OPPORTUNITY
 * - SAFETY CAR STRATEGY OPPORTUNITY
 * 
 * Feeds advisory intelligence into the Prescription Engine without overriding safety-critical pit logic.
 */

import { getDegradationDelta, getEffectivePitCost, PIT_LANE_LOSS, getCompoundCliffLap } from './strategy.js';
import { evaluateTyreRecovery } from './tyreRecovery.js';

/**
 * Detects strategic and tactical opportunities for the given car in the race.
 *
 * @param {Object} car - Current car being evaluated
 * @param {Array<Object>} allCars - All 20 simulated cars
 * @param {number} currentLap - Current race lap
 * @param {number} totalLaps - Total race laps
 * @param {string} raceEvent - Current race state ('GREEN', 'SC', 'VSC')
 * @param {Object} [modelData] - Model pipeline parameters
 * @returns {Object} Detected opportunities list, ranked by score
 */
export function detectRaceOpportunities(car, allCars, currentLap, totalLaps, raceEvent = 'GREEN', modelData = null) {
  const opportunities = [];
  const lapsRemaining = Math.max(0, totalLaps - currentLap);
  const compound = car.compound || 'MEDIUM';
  const tyreAge = car.tyreAge || 0;
  const cliffLap = getCompoundCliffLap(compound);

  // Find nearest competitor ahead and behind
  const sortedCars = (allCars || []).slice().sort((a, b) => (a.position || 99) - (b.position || 99));
  const carIdx = sortedCars.findIndex(c => c.id === car.id);
  const rivalAhead = carIdx > 0 ? sortedCars[carIdx - 1] : null;
  const rivalBehind = (carIdx >= 0 && carIdx < sortedCars.length - 1) ? sortedCars[carIdx + 1] : null;

  // ── 1. UNDERCUT OPPORTUNITY ──
  if (rivalAhead && lapsRemaining >= 6 && (car.pitStops || 0) === 0) {
    const gapAhead = car.gapToAheadTime !== undefined ? car.gapToAheadTime : 1.8;
    const rivalAge = rivalAhead.tyreAge || 1;
    const rivalDegRate = rivalAhead.dynamicDegradation?.currentRate || 0.08;
    const ourDegRate = car.dynamicDegradation?.currentRate || 0.06;
    
    // Fresh tyre pace advantage (switching from worn to fresh Hard/Medium ~1.2s - 2.0s/lap)
    const freshTyreDelta = 1.6;
    const pitLoss = getEffectivePitCost();
    
    // An undercut is most potent when:
    // - Gap to car ahead is between 0.8s and 3.5s (within pit window)
    // - Rival's tyres are old or degrading faster
    // - There are sufficient laps remaining to make the stop pay off
    let undercutScore = 0;
    let confidence = 'MEDIUM';
    
    if (gapAhead >= 0.5 && gapAhead <= 3.8) {
      const gapScore = Math.max(0, 1.0 - Math.abs(gapAhead - 1.8) / 2.5); // Peak score at 1.8s gap
      const degAdvantageScore = Math.min(1.0, Math.max(0, (rivalAge - tyreAge + 4) / 15.0));
      const horizonScore = Math.min(1.0, lapsRemaining / 20.0);
      
      undercutScore = Math.round((gapScore * 45) + (degAdvantageScore * 35) + (horizonScore * 20));
      if (undercutScore > 75) confidence = 'HIGH';
      else if (undercutScore < 40) confidence = 'LOW';

      const netTrackPosGain = (freshTyreDelta * 1.5 - gapAhead).toFixed(1);

      opportunities.push({
        type: 'UNDERCUT',
        title: 'UNDERCUT OPPORTUNITY',
        score: undercutScore,
        confidence,
        targetCar: `P${rivalAhead.position || '?'} #${rivalAhead.number || '?'}`,
        reason: `Car ahead P${rivalAhead.position || '?'} is ${gapAhead.toFixed(1)}s ahead with ${rivalAge}L tyre age. Pitting now exploits fresh tyre delta.`,
        benefit: `+${Math.max(0.4, Number(netTrackPosGain))}s net delta on out-lap`
      });
    }
  }

  // ── 2. EXTEND STINT OPPORTUNITY ──
  const dynDeg = car.dynamicDegradation || { currentRate: 0.06, acceleration: 0.003, isAccelerating: false };
  const tyreEnergyRem = car.tyreHealth?.tyreEnergyLaps ?? Math.max(0, cliffLap - tyreAge);
  
  if (tyreEnergyRem >= 4 && !dynDeg.isSevere && tyreAge < cliffLap - 2) {
    let extendScore = 50;
    if (dynDeg.acceleration <= 0.004) extendScore += 25;
    if (car.thermalState?.tyreTemp <= (car.thermalState?.optimalTemp || 100) + 4) extendScore += 15;
    if (tyreEnergyRem >= 8) extendScore += 10;
    
    extendScore = Math.min(95, extendScore);
    const conf = extendScore > 75 ? 'HIGH' : 'MEDIUM';

    opportunities.push({
      type: 'EXTEND_STINT',
      title: 'EXTEND STINT OPPORTUNITY',
      score: extendScore,
      confidence: conf,
      reason: `Degradation rate remains stable (${dynDeg.rateFormatted}) with ${tyreEnergyRem} laps competitive tyre life.`,
      benefit: `Preserves track position & shortens final stint by 2-4 laps`
    });
  }

  // ── 3. TYRE RECOVERY OPPORTUNITY ──
  const recoveryInfo = evaluateTyreRecovery(car, modelData, 2);
  if (recoveryInfo.isRecoverable && recoveryInfo.recoveryPotentialPct >= 35) {
    opportunities.push({
      type: 'TYRE_RECOVERY',
      title: 'TYRE RECOVERY OPPORTUNITY',
      score: recoveryInfo.recoveryPotentialPct,
      confidence: recoveryInfo.recoveryPotentialPct >= 60 ? 'HIGH' : 'MEDIUM',
      reason: recoveryInfo.explanation,
      benefit: `Recovers ${recoveryInfo.recoverableFormatted} without sacrificing pit loss`
    });
  }

  // ── 4. OVERTAKE OPPORTUNITY ──
  if (rivalAhead) {
    const gapAhead = car.gapToAheadTime !== undefined ? car.gapToAheadTime : 2.0;
    if (gapAhead <= 1.2) {
      let overtakeScore = Math.round(Math.min(96, Math.max(30, (1.2 - gapAhead) * 50 + 40)));
      if (car.driverBehaviour?.state === 'ATTACK') overtakeScore += 8;
      
      overtakeScore = Math.min(98, overtakeScore);
      opportunities.push({
        type: 'OVERTAKE',
        title: 'OVERTAKE OPPORTUNITY',
        score: overtakeScore,
        confidence: gapAhead <= 0.7 ? 'HIGH' : 'MEDIUM',
        targetCar: `P${rivalAhead.position || '?'} #${rivalAhead.number || '?'}`,
        reason: `Within DRS range (${gapAhead.toFixed(1)}s behind P${rivalAhead.position || '?'}). Exit traction is superior.`,
        benefit: `Direct on-track overtake into heavy braking zone`
      });
    }
  }

  // ── 5. COMPETITOR DEGRADATION OPPORTUNITY ──
  // Check if any car within 3 positions ahead is suffering severe degradation
  const aheadCompetitors = sortedCars.slice(Math.max(0, carIdx - 3), carIdx);
  const strugglingRival = aheadCompetitors.find(r => {
    const rAge = r.tyreAge || 0;
    const rTemp = r.thermalState?.tyreTemp || 100;
    return (rAge >= 22 || rTemp > 108 || (r.dynamicDegradation?.isSevere));
  });

  if (strugglingRival) {
    opportunities.push({
      type: 'COMPETITOR_DEGRADATION',
      title: 'RIVAL DEGRADATION OPPORTUNITY',
      score: 84,
      confidence: 'HIGH',
      targetCar: `P${strugglingRival.position || '?'} #${strugglingRival.number || '?'}`,
      reason: `Rival P${strugglingRival.position || '?'} #${strugglingRival.number || '?'} is suffering thermal breakdown (${strugglingRival.tyreAge || 20}L age).`,
      benefit: `Pace difference +0.45s/lap creates imminent overtake window`
    });
  }

  // ── 6. SAFETY CAR STRATEGY OPPORTUNITY ──
  if (raceEvent === 'SC' || raceEvent === 'VSC') {
    const scBenefitSeconds = raceEvent === 'SC' ? 11.0 : 8.0;
    opportunities.push({
      type: 'SAFETY_CAR',
      title: `${raceEvent} CHEAP PIT OPPORTUNITY`,
      score: 95,
      confidence: 'HIGH',
      reason: `${raceEvent} neutralizes track delta. Pit stop time loss is reduced by 45-55%.`,
      benefit: `Saves ~${scBenefitSeconds}s compared to full-speed green flag pit stop`
    });
  }

  // Sort opportunities descending by score
  opportunities.sort((a, b) => b.score - a.score);

  return {
    opportunities,
    primaryOpportunity: opportunities[0] || null,
    totalCount: opportunities.length
  };
}
