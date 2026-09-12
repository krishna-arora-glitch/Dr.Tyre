/**
 * individualTyres.js — Individual Tyre Degradation Matrix (FL, FR, RL, RR)
 * 
 * Physics-informed non-uniform decomposition of car tyre degradation into 4 corners:
 * - Front Left (FL)
 * - Front Right (FR)
 * - Rear Left (RL)
 * - Rear Right (RR)
 * 
 * The car's authoritative degradation rate (getMarginalDegRate / tyreHealth)
 * is preserved as the exact 4-corner mean, ensuring complete internal consistency.
 */

import { COMPOUND_THERMAL_WINDOWS } from './strategy.js';

/**
 * Calculates independent tyre degradation for all four corners.
 *
 * @param {Object} car - Live simulated car object
 * @param {Object} [modelData] - Pipeline model parameters
 * @returns {Object} 4-tyre matrix state and comparative summary
 */
export function computeIndividualTyres(car, modelData = null) {
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  const setup = car.setup || null;
  const speed = (car.speed !== undefined && !isNaN(car.speed)) ? car.speed : 160;
  const brake = (car.brake !== undefined && !isNaN(car.brake)) ? car.brake : (car.prevBrake || 0);
  const throttle = (car.throttle !== undefined && !isNaN(car.throttle)) ? car.throttle : (car.prevThrottle || 80);
  const thermalState = car.thermalState || null;
  const driverBehaviour = car.driverBehaviour || null;
  const aeroInterference = car.aeroInterference || 0;

  // Authoritative car-level marginal degradation rate (s/lap)
  const baseDegRate = car.tyreHealth?.marginalDegRate !== undefined
    ? car.tyreHealth.marginalDegRate
    : 0.065;

  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const carTemp = thermalState?.tyreTemp !== undefined ? thermalState.tyreTemp : (car.tyreTemp || win.opt);

  // ── 1. Longitudinal Load Attribution (Braking vs Traction) ──
  // Brake Bias: default is ~56% Front / 44% Rear
  let frontBrakeShare = 0.56;
  if (setup?.brakeBias === 'FRONT') frontBrakeShare = 0.62;
  else if (setup?.brakeBias === 'REAR') frontBrakeShare = 0.50;
  const rearBrakeShare = 1.0 - frontBrakeShare;

  // Traction: 75% Rear Axle / 25% Front (weight transfer upon acceleration)
  const rearTractionShare = 0.75;
  const frontTractionShare = 0.25;

  // Normalized braking demand [0, 1]
  const brakeIntensity = Math.min(1.0, Math.max(0, brake / 4.0));
  // Normalized traction demand [0, 1] (high throttle and exiting corner / accelerating)
  const throttleIntensity = Math.min(1.0, Math.max(0, (throttle - 85) / 15.0));

  // Axle longitudinal stress multipliers
  const frontLongitudinalStress = (brakeIntensity * frontBrakeShare * 1.6) + (throttleIntensity * frontTractionShare * 0.4);
  const rearLongitudinalStress = (brakeIntensity * rearBrakeShare * 1.0) + (throttleIntensity * rearTractionShare * 1.5);

  // ── 2. Lateral Cornering Load Attribution (Left vs Right) ──
  // Determine lateral bias from track position / curvature
  // In Singapore (clockwise street circuit with high-load turns 7, 14, 20),
  // right-hand turns heavily load left tyres (FL, RL), left-hand turns load right tyres (FR, RR).
  const normProg = ((car.progress % 1) + 1) % 1;
  
  // High-stress cornering zones in Singapore / standard track profile
  // Approximates lateral G load vector: +1.0 = heavy right turn (loads left tyres FL/RL)
  //                                    -1.0 = heavy left turn (loads right tyres FR/RR)
  let lateralGVector = 0.25; // Slight clockwise bias default
  if (normProg >= 0.08 && normProg <= 0.22) {
    // Turn 1-3 complex (Right-Left-Right) -> loads left then right
    lateralGVector = 0.75;
  } else if (normProg >= 0.30 && normProg <= 0.42) {
    // Turn 7 hard 90° left -> loads right tyres FR/RR
    lateralGVector = -0.85;
  } else if (normProg >= 0.45 && normProg <= 0.60) {
    // Padang / Padang chicane turns -> rapid right loading
    lateralGVector = 0.80;
  } else if (normProg >= 0.65 && normProg <= 0.78) {
    // Turn 14 heavy 90° right -> heavy left tyre loading
    lateralGVector = 0.90;
  } else if (normProg >= 0.82 && normProg <= 0.95) {
    // Turn 16-19 final sequence (lefts and rights)
    lateralGVector = -0.65;
  }

  // Speed-scaled lateral G force
  const lateralGMagnitude = Math.min(1.0, Math.pow(Math.min(speed, 220) / 190.0, 1.8));
  const signedLateralG = lateralGVector * lateralGMagnitude; // [-1.0, 1.0]

  // Outside tyre load increase:
  // If signedLateralG > 0 (right turn): Left tyres take 65%, Right tyres take 35%
  // If signedLateralG < 0 (left turn):  Right tyres take 65%, Left tyres take 35%
  const leftLateralShare = 0.50 + 0.25 * signedLateralG;
  const rightLateralShare = 1.0 - leftLateralShare;

  // ── 3. Mechanical Balance & Aero Balance Modifiers ──
  // Front aero balance increases front cornering scrub
  const aeroFrontBias = setup?.balance === 'FRONT' ? 1.08 : (setup?.balance === 'REAR' ? 0.94 : 1.0);
  const aeroRearBias = setup?.balance === 'REAR' ? 1.08 : (setup?.balance === 'FRONT' ? 0.94 : 1.0);

  // Driver behaviour aggression modifier
  const behModifier = driverBehaviour?.tyreStressModifier || 1.0;

  // ── 4. Synthesize Unnormalized Stress Weights per Corner ──
  // FL: Front axle (braking + front aero scrub) + Left side (right turn lateral load)
  const rawStressFL = (1.0 + frontLongitudinalStress * 0.5 + leftLateralShare * 0.75 * aeroFrontBias) * behModifier;
  // FR: Front axle (braking + front aero scrub) + Right side (left turn lateral load)
  const rawStressFR = (1.0 + frontLongitudinalStress * 0.5 + rightLateralShare * 0.75 * aeroFrontBias) * behModifier;
  // RL: Rear axle (traction + rear aero stability) + Left side
  const rawStressRL = (1.0 + rearLongitudinalStress * 0.55 + leftLateralShare * 0.65 * aeroRearBias) * behModifier;
  // RR: Rear axle (traction + rear aero stability) + Right side
  const rawStressRR = (1.0 + rearLongitudinalStress * 0.55 + rightLateralShare * 0.65 * aeroRearBias) * behModifier;

  const totalRawStress = rawStressFL + rawStressFR + rawStressRL + rawStressRR;
  // Normalized shares summing to exactly 1.00
  const shareFL = rawStressFL / totalRawStress;
  const shareFR = rawStressFR / totalRawStress;
  const shareRL = rawStressRL / totalRawStress;
  const shareRR = rawStressRR / totalRawStress;

  // ── 5. Corner Temperature & Thermal State ──
  // Corner temperatures deviate dynamically around carTemp based on their share of work
  const tempDeviationScale = 14.0; // Max ~±5-7°C differential between highest and lowest corner
  const tempFL = Math.round((carTemp + (shareFL - 0.25) * tempDeviationScale) * 10) / 10;
  const tempFR = Math.round((carTemp + (shareFR - 0.25) * tempDeviationScale) * 10) / 10;
  const tempRL = Math.round((carTemp + (shareRL - 0.25) * tempDeviationScale) * 10) / 10;
  const tempRR = Math.round((carTemp + (shareRR - 0.25) * tempDeviationScale) * 10) / 10;

  function getThermalStateName(t) {
    if (t >= win.blister) return 'BLISTER';
    if (t >= win.opt + 8) return 'HOT';
    if (t >= win.opt + 3) return 'WARM';
    if (t <= win.opt - 10) return 'COLD';
    return 'OPT';
  }

  // ── 6. Degradation Rate Deconvolution (Internal Consistency Check) ──
  // By setting degRate_i = baseDegRate * (4 * share_i),
  // (degRate_FL + degRate_FR + degRate_RL + degRate_RR) / 4 = baseDegRate * sum(share_i) = baseDegRate
  // Exactly preserves the authoritative ML/LME rate!
  const degRateFL = Math.max(0.005, baseDegRate * (4.0 * shareFL));
  const degRateFR = Math.max(0.005, baseDegRate * (4.0 * shareFR));
  const degRateRL = Math.max(0.005, baseDegRate * (4.0 * shareRL));
  const degRateRR = Math.max(0.005, baseDegRate * (4.0 * shareRR));

  // ── 7. Health % and Remaining Competitive Laps ──
  // Car base health from tyreHealth
  const carHealth = car.tyreHealth?.gripLevel ?? Math.max(10, 100 - tyreAge * 3.2);
  const baseLapsRem = car.tyreHealth?.tyreEnergyLaps ?? Math.max(0, 32 - tyreAge);

  function computeCornerHealth(share, degRate) {
    // Tyres with higher wear rate decay faster
    const healthPenalty = (share - 0.25) * 85.0;
    const health = Math.max(5, Math.min(100, Math.round(carHealth - healthPenalty)));
    const remainingLaps = Math.max(0, Math.round(baseLapsRem * (0.25 / share)));
    return { health, remainingLaps };
  }

  const hFL = computeCornerHealth(shareFL, degRateFL);
  const hFR = computeCornerHealth(shareFR, degRateFR);
  const hRL = computeCornerHealth(shareRL, degRateRL);
  const hRR = computeCornerHealth(shareRR, degRateRR);

  // ── 8. Degradation Acceleration per Corner (s/lap²) ──
  // Previous tick acceleration storage or approximation from thermal deviation
  const baseAccel = car.dynamicDegradation?.acceleration || 0.004;
  const accelFL = Number((baseAccel * (shareFL / 0.25)).toFixed(3));
  const accelFR = Number((baseAccel * (shareFR / 0.25)).toFixed(3));
  const accelRL = Number((baseAccel * (shareRL / 0.25)).toFixed(3));
  const accelRR = Number((baseAccel * (shareRR / 0.25)).toFixed(3));

  // ── 9. Compile Corner Objects ──
  const corners = {
    FL: {
      name: 'FL',
      label: 'Front Left',
      degradationRate: Number(degRateFL.toFixed(3)),
      degradationAcceleration: accelFL,
      tyreAge,
      temperature: tempFL,
      thermalState: getThermalStateName(tempFL),
      mechanicalStressContribution: Math.round(shareFL * 100),
      estimatedRemainingCompetitiveLife: hFL.remainingLaps,
      health: hFL.health,
      relativeDegradation: 1.0 // Set below
    },
    FR: {
      name: 'FR',
      label: 'Front Right',
      degradationRate: Number(degRateFR.toFixed(3)),
      degradationAcceleration: accelFR,
      tyreAge,
      temperature: tempFR,
      thermalState: getThermalStateName(tempFR),
      mechanicalStressContribution: Math.round(shareFR * 100),
      estimatedRemainingCompetitiveLife: hFR.remainingLaps,
      health: hFR.health,
      relativeDegradation: 1.0
    },
    RL: {
      name: 'RL',
      label: 'Rear Left',
      degradationRate: Number(degRateRL.toFixed(3)),
      degradationAcceleration: accelRL,
      tyreAge,
      temperature: tempRL,
      thermalState: getThermalStateName(tempRL),
      mechanicalStressContribution: Math.round(shareRL * 100),
      estimatedRemainingCompetitiveLife: hRL.remainingLaps,
      health: hRL.health,
      relativeDegradation: 1.0
    },
    RR: {
      name: 'RR',
      label: 'Rear Right',
      degradationRate: Number(degRateRR.toFixed(3)),
      degradationAcceleration: accelRR,
      tyreAge,
      temperature: tempRR,
      thermalState: getThermalStateName(tempRR),
      mechanicalStressContribution: Math.round(shareRR * 100),
      estimatedRemainingCompetitiveLife: hRR.remainingLaps,
      health: hRR.health,
      relativeDegradation: 1.0
    }
  };

  // ── 10. Identify Limiting / Worst Tyre & Comparative Ratios ──
  const cornerList = [corners.FL, corners.FR, corners.RL, corners.RR];
  cornerList.sort((a, b) => b.degradationRate - a.degradationRate);
  const worstCorner = cornerList[0];
  const bestCorner = cornerList[3];

  const worstRatio = bestCorner.degradationRate > 0
    ? Number((worstCorner.degradationRate / bestCorner.degradationRate).toFixed(2))
    : 1.0;

  // Set relative degradation compared to best tyre
  cornerList.forEach(c => {
    c.relativeDegradation = bestCorner.degradationRate > 0
      ? Number((c.degradationRate / bestCorner.degradationRate).toFixed(2))
      : 1.0;
  });

  let imbalanceMessage = '';
  if (worstRatio >= 1.20) {
    imbalanceMessage = `${worstCorner.name} degrading ${worstRatio}× faster than ${bestCorner.name}`;
  } else {
    imbalanceMessage = 'Tyre wear evenly distributed across axles';
  }

  return {
    FL: corners.FL,
    FR: corners.FR,
    RL: corners.RL,
    RR: corners.RR,
    limitingTyre: worstCorner.name,
    worstTyre: worstCorner.name,
    bestTyre: bestCorner.name,
    worstRatio,
    imbalanceMessage,
    authoritativeMeanRate: Number((baseDegRate).toFixed(3))
  };
}
