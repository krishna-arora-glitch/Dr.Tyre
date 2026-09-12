/**
 * trackDegradationMap.js — Track Degradation Intensity & Workload Mapping
 * 
 * Divides circuits into discrete turn/sector bins and attributes tyre wear intensity [0-100]
 * based on braking deceleration, lateral cornering G, longitudinal traction, and thermal load.
 */

import { getProfileAvgSpeed } from './trackDynamics.js';

// Circuit Turn & Sector Definitions
export const CIRCUIT_SEGMENTS = {
  singapore: [
    { id: 'T1_3', name: 'Turns 1-3 (Sheares)', sector: 1, startPos: 0.00, endPos: 0.12, type: 'HEAVY_BRAKING' },
    { id: 'T4_5', name: 'Turns 4-5 (Republic)', sector: 1, startPos: 0.12, endPos: 0.22, type: 'TRACTION' },
    { id: 'S1_STRAIGHT', name: 'Raffles Ave Straight', sector: 1, startPos: 0.22, endPos: 0.30, type: 'HIGH_SPEED' },
    { id: 'T7', name: 'Turn 7 (Memorial Corner)', sector: 2, startPos: 0.30, endPos: 0.39, type: 'HEAVY_BRAKING' },
    { id: 'T8_9', name: 'Turns 8-9 (Stamford / Connaught)', sector: 2, startPos: 0.39, endPos: 0.48, type: 'CORNERING' },
    { id: 'T10', name: 'Turn 10 (Padang Complex)', sector: 2, startPos: 0.48, endPos: 0.56, type: 'CORNERING' },
    { id: 'T11_13', name: 'Turns 11-13 (Anderson Bridge)', sector: 2, startPos: 0.56, endPos: 0.65, type: 'TECHNICAL' },
    { id: 'T14', name: 'Turn 14 (Esplanade End-Braking)', sector: 3, startPos: 0.65, endPos: 0.74, type: 'HEAVY_BRAKING' },
    { id: 'T15_17', name: 'Turns 15-17 (Bay Grandstand)', sector: 3, startPos: 0.74, endPos: 0.84, type: 'TRACTION' },
    { id: 'T18_19', name: 'Turns 18-19 (Under Grandstand)', sector: 3, startPos: 0.84, endPos: 0.92, type: 'TECHNICAL' },
    { id: 'PIT_STRAIGHT', name: 'Main Pit Straight', sector: 3, startPos: 0.92, endPos: 1.00, type: 'HIGH_SPEED' }
  ],
  monza: [
    { id: 'VAR1', name: 'Variante del Rettifilo (T1-2)', sector: 1, startPos: 0.00, endPos: 0.20, type: 'HEAVY_BRAKING' },
    { id: 'CURVA_GRANDE', name: 'Curva Grande (T3)', sector: 1, startPos: 0.20, endPos: 0.36, type: 'HIGH_SPEED' },
    { id: 'VAR2', name: 'Variante della Roggia (T4-5)', sector: 2, startPos: 0.36, endPos: 0.52, type: 'HEAVY_BRAKING' },
    { id: 'LESMI', name: 'Curve di Lesmo (T6-7)', sector: 2, startPos: 0.52, endPos: 0.70, type: 'CORNERING' },
    { id: 'SERRAGLIO', name: 'Curva del Serraglio', sector: 3, startPos: 0.70, endPos: 0.78, type: 'HIGH_SPEED' },
    { id: 'ASCARI', name: 'Variante Ascari (T8-10)', sector: 3, startPos: 0.78, endPos: 0.88, type: 'TECHNICAL' },
    { id: 'PARABOLICA', name: 'Curva Parabolica (T11)', sector: 3, startPos: 0.88, endPos: 1.00, type: 'CORNERING' }
  ],
  monaco: [
    { id: 'STE_DEVOTE', name: 'Sainte Dévote (T1)', sector: 1, startPos: 0.00, endPos: 0.18, type: 'HEAVY_BRAKING' },
    { id: 'BEAU_RIVAGE', name: 'Beau Rivage & Massenet (T2-3)', sector: 1, startPos: 0.18, endPos: 0.34, type: 'HIGH_SPEED' },
    { id: 'CASINO', name: 'Casino Square & Mirabeau (T4-5)', sector: 1, startPos: 0.34, endPos: 0.48, type: 'TECHNICAL' },
    { id: 'HAIRPIN', name: 'Grand Hotel Hairpin (T6)', sector: 2, startPos: 0.48, endPos: 0.60, type: 'HEAVY_BRAKING' },
    { id: 'TUNNEL', name: 'The Tunnel (T7-8)', sector: 2, startPos: 0.60, endPos: 0.74, type: 'HIGH_SPEED' },
    { id: 'CHICANE', name: 'Nouvelle Chicane & Tabac (T10-12)', sector: 3, startPos: 0.74, endPos: 0.88, type: 'TECHNICAL' },
    { id: 'SWIMMING_POOL', name: 'Swimming Pool & Rascasse (T13-19)', sector: 3, startPos: 0.88, endPos: 1.00, type: 'CORNERING' }
  ]
};

/**
 * Computes live degradation intensity and contributor breakdown for all segments of a track.
 *
 * @param {string} trackId - 'singapore', 'monza', or 'monaco'
 * @param {Object} car - Simulated car object
 * @param {Object} [modelData] - Telemetry model output
 * @returns {Array<Object>} List of evaluated track segments with intensity scores
 */
export function computeTrackDegradationMap(trackId = 'singapore', car = null, modelData = null) {
  const segments = CIRCUIT_SEGMENTS[trackId] || CIRCUIT_SEGMENTS.singapore;
  const speed = (car?.speed !== undefined && !isNaN(car.speed)) ? car.speed : 160;
  const tyreTemp = car?.thermalState?.tyreTemp || car?.tyreTemp || 100;
  const optTemp = car?.thermalState?.optimalTemp || 100;
  const deltaT = Math.max(0, tyreTemp - optTemp);
  const aeroInterference = car?.aeroInterference || 0;
  const behMod = car?.driverBehaviour?.tyreStressModifier || 1.0;

  return segments.map(seg => {
    let baseBraking = 0.2;
    let baseCornering = 0.25;
    let baseTraction = 0.25;
    let baseSpeed = 0.3;

    if (seg.type === 'HEAVY_BRAKING') {
      baseBraking = 0.75;
      baseCornering = 0.45;
      baseTraction = 0.30;
      baseSpeed = 0.25;
    } else if (seg.type === 'CORNERING') {
      baseBraking = 0.25;
      baseCornering = 0.80;
      baseTraction = 0.40;
      baseSpeed = 0.35;
    } else if (seg.type === 'TRACTION') {
      baseBraking = 0.30;
      baseCornering = 0.35;
      baseTraction = 0.85;
      baseSpeed = 0.30;
    } else if (seg.type === 'HIGH_SPEED') {
      baseBraking = 0.10;
      baseCornering = 0.20;
      baseTraction = 0.35;
      baseSpeed = 0.90;
    } else { // TECHNICAL
      baseBraking = 0.50;
      baseCornering = 0.60;
      baseTraction = 0.50;
      baseSpeed = 0.30;
    }

    // Dynamic telemetry modulation
    // High speeds scale cornering lateral G quadratically
    const corneringStress = baseCornering * (0.8 + 0.3 * Math.pow(Math.min(speed, 240) / 180, 1.6));
    // Braking stress scaled by driver behaviour aggression
    const brakingStress = baseBraking * behMod;
    // Traction stress scaled by rear tyre wear and throttle demand
    const tractionStress = baseTraction * (0.9 + 0.2 * (car?.tyreAge || 1) / 30);
    // Thermal stress scaled by deltaT and dirty air
    const thermalStress = 0.25 + (deltaT / 15.0) * 0.55 + (aeroInterference * 0.20);
    // Sustained speed friction
    const speedStress = baseSpeed * (speed / 200);

    // Sum unnormalized components
    const wB = 0.25, wC = 0.35, wTr = 0.20, wTh = 0.20;
    const rawIntensity = (wB * brakingStress) + (wC * corneringStress) + (wTr * tractionStress) + (wTh * thermalStress);

    // Continuous normalized score in [0, 100]
    const intensity = Math.round(Math.max(12, Math.min(98, rawIntensity * 85)));

    // Relative contributor percentages summing to 100%
    const totalContributors = corneringStress + thermalStress + brakingStress + tractionStress;
    const pctCornering = Math.round((corneringStress / totalContributors) * 100);
    const pctThermal = Math.round((thermalStress / totalContributors) * 100);
    const pctBraking = Math.round((brakingStress / totalContributors) * 100);
    const pctTraction = 100 - (pctCornering + pctThermal + pctBraking);

    // Identify primary stress tag
    let primaryTag = 'MODERATE WEAR';
    if (intensity >= 65) {
      if (pctCornering >= 38) primaryTag = 'HIGH CORNERING STRESS';
      else if (pctBraking >= 32) primaryTag = 'HIGH BRAKING STRESS';
      else if (pctThermal >= 30) primaryTag = 'HIGH THERMAL LOAD';
      else if (pctTraction >= 30) primaryTag = 'HIGH TRACTION STRESS';
      else primaryTag = 'HIGH COMBINED STRESS';
    } else if (intensity <= 35) {
      primaryTag = 'LOW WEAR ZONE';
    } else {
      primaryTag = 'BALANCED WEAR';
    }

    // Color gradient for visualization
    let color = '#16a34a'; // Green
    if (intensity >= 75) color = '#dc2626'; // Red
    else if (intensity >= 55) color = '#ea580c'; // Orange
    else if (intensity >= 40) color = '#d97706'; // Amber

    return {
      id: seg.id,
      name: seg.name,
      sector: seg.sector,
      startPos: seg.startPos,
      endPos: seg.endPos,
      intensity,
      primaryTag,
      color,
      contributors: {
        cornering: pctCornering,
        thermal: pctThermal,
        braking: pctBraking,
        traction: pctTraction
      }
    };
  });
}

/**
 * Returns the track segment matching a given normalized track position [0, 1).
 */
export function getActiveTrackSegment(trackMap, normProg) {
  if (!trackMap || trackMap.length === 0) return null;
  const p = ((normProg % 1) + 1) % 1;
  const match = trackMap.find(s => p >= s.startPos && p < s.endPos);
  return match || trackMap[trackMap.length - 1];
}
