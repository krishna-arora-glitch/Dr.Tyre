import { COMPOUND_THERMAL_WINDOWS, calculateThermalPenalty, getCompoundCliffLap, getMarginalDegRate, getDegradationDelta, getSimulationLapStress } from './strategy.js';

export function computeTyreHealth(car, modelData = null) {
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  const setup = car.setup || null;
  const thermalState = car.thermalState || null;
  const speed = (car.speed !== undefined && !isNaN(car.speed)) ? car.speed : 180;
  const aeroInterference = car.aeroInterference || 0.0;

  // 1. Base Physical Properties from Models
  const cliffLap = getCompoundCliffLap(compound);
  const degDelta = getDegradationDelta(compound, tyreAge, setup, thermalState, aeroInterference);
  const marginalDegRate = getMarginalDegRate(compound, tyreAge, setup);
  
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const tyreTemp = thermalState?.tyreTemp !== undefined ? thermalState.tyreTemp : (car.tyreTemp || win.opt);
  const deltaT = Math.max(0, tyreTemp - win.opt);
  const thermalZ = deltaT > 0 ? (deltaT / 12.0) : 0.0;
  const lapStress = getSimulationLapStress(setup, thermalZ, aeroInterference);
  const thermalPenaltyRes = calculateThermalPenalty(compound, tyreAge, tyreTemp);
  const blisterFactor = thermalPenaltyRes.blisterFactor || 1.0;
  const overheatFactor = thermalPenaltyRes.overheatFactor || 1.0;

  // ── A. GRIP LEVEL (0-100%) — F1 MONOTONIC WEAR CEILING + THERMAL SUPPRESSION ──
  // 1. Permanent Wear Ceiling: strictly decays monotonically with tyreAge and compound degradation.
  // Physical chemical wear cannot be reversed by cooling down or straights.
  let wearGripCeiling;
  if (tyreAge <= cliffLap) {
    // Smooth power decay down to 25% at the cliff lap
    wearGripCeiling = 1.0 - 0.75 * Math.pow(tyreAge / Math.max(1, cliffLap), 1.15);
  } else {
    // Past cliff: rapid drop towards 10% structural floor
    const pastCliff = tyreAge - cliffLap;
    const pastCliffBudget = Math.max(3, cliffLap * 0.35);
    wearGripCeiling = Math.max(0.10, 0.25 * (1.0 - (pastCliff / pastCliffBudget)));
  }

  // 2. Thermal Suppression Factor: overheating and blistering suppress grip below the wear ceiling
  const thermalSuppression = Math.min(0.25, (deltaT / 20.0) * 0.15 + (Math.max(0, blisterFactor - 1.0) / 2.5) * 0.10);
  
  // 3. Current Usable Grip: always clamped by wearGripCeiling.
  // As tyre cools down, grip recovers UP TO the wear ceiling, but NEVER exceeds previous laps' wear.
  const usableGripFraction = Math.max(0.10, wearGripCeiling * (1.0 - thermalSuppression));
  const gripLevel = Math.round(Math.max(10, Math.min(100, 100 * usableGripFraction)));

  // ── B. TREAD REMAINING (0-100%) ──
  // Remaining useful tyre life before exiting acceptable performance envelope
  let treadFraction;
  if (tyreAge <= cliffLap) {
    // Linear-to-smooth drop down to 20% at the cliff lap
    treadFraction = 1.0 - 0.80 * (tyreAge / Math.max(1, cliffLap));
  } else {
    // Past cliff: drops rapidly from 20% towards 0%
    const pastCliff = tyreAge - cliffLap;
    const pastCliffBudget = Math.max(3, cliffLap * 0.35);
    treadFraction = Math.max(0, 0.20 * (1.0 - (pastCliff / pastCliffBudget)));
  }
  const treadRemaining = Math.round(Math.max(0, Math.min(100, 100 * treadFraction)));

  // ── C. DEGRADATION RATE (s/lap) ──
  const degRateFormatted = `${marginalDegRate >= 0 ? '+' : ''}${marginalDegRate.toFixed(3)} s/lap`;

  // ── D. TYRE ENERGY (Laps remaining) ──
  // Useful life before exceeding acceptable envelope, modulated by thermal & stress acceleration
  const nominalLapsRemaining = Math.max(0, cliffLap - tyreAge);
  const burnMultiplier = Math.max(1.0, (overheatFactor * blisterFactor) * (1.0 + 0.12 * Math.max(0, lapStress)));
  const tyreEnergyLaps = Math.max(0, Math.floor(nominalLapsRemaining / burnMultiplier));
  const tyreEnergyText = tyreAge >= cliffLap ? '0 LAPS (CLIFF)' : `${tyreEnergyLaps} LAPS`;

  // ── E. PUNCTURE RISK ESTIMATION: COX PROPORTIONAL HAZARDS SURVIVAL ENGINE ──
  // Mathematically bridges physical stress to cumulative failure probability:
  // h(t | X) = h_0(t) * exp(beta^T * X)
  // S(t | X) = exp(- H_0(t) * HazardRatio)
  // PunctureRisk = 1.0 - S(t | X)
  
  // 1. Weibull Baseline Cumulative Hazard: H_0(t) = (tyreAge / lambda_0)^k
  // k = 2.5 (wear-out shape parameter matching logistics survival pipeline)
  // lambda_0 = 1.25 * cliffLap (scale parameter where un-stressed tyre approaches failure)
  const weibullShape = 2.5;
  const baseLambda = 1.25 * Math.max(1, cliffLap);
  const baselineAgeRatio = tyreAge / baseLambda;
  const H0 = Math.pow(baselineAgeRatio, weibullShape);

  // 2. Physical Covariates (X) normalized to operating deviations
  const X_thermal = Math.max(0, (tyreTemp - win.opt) / 16.0);
  const X_blister = Math.max(0, (blisterFactor - 1.0) / 2.0);
  const X_stress = Math.max(0, (lapStress + 0.3) / 1.5);
  const X_speed = Math.max(0, (speed - 160) / 140.0);
  const X_cliff = tyreAge >= cliffLap 
    ? (1.0 + (tyreAge - cliffLap) / Math.max(3, cliffLap * 0.25))
    : (tyreAge >= cliffLap - 4 ? (0.4 + 0.6 * (tyreAge - (cliffLap - 4)) / 4.0) : 0.0);

  // 3. Log-Hazard Coefficients (beta) from physical wear and structural strain
  const beta_thermal = 0.85;
  const beta_blister = 1.20;
  const beta_stress = 0.65;
  const beta_speed = 0.50;
  const beta_cliff = 0.90;

  // 4. Log-Hazard Ratio & Exponent Multiplier
  const logHazardRatio = (
    beta_thermal * X_thermal +
    beta_blister * X_blister +
    beta_stress * X_stress +
    beta_speed * X_speed +
    beta_cliff * X_cliff
  );
  const hazardMultiplier = Math.exp(Math.min(3.5, logHazardRatio)); // Clamped to avoid float overflow

  // 5. Cumulative Hazard & Survival Probability S(t | X)
  const cumulativeHazard = H0 * hazardMultiplier;
  const survivalProb = Math.exp(-cumulativeHazard);

  // 6. Final Failure / Puncture Risk Probability (with 3% baseline debris floor, clamped at 95%)
  const rawPunctureRisk = 100 * (0.03 + 0.97 * (1.0 - survivalProb));
  const punctureRiskScore = Math.round(Math.max(3, Math.min(95, rawPunctureRisk)));

  let punctureRiskLevel = 'LOW';
  let punctureRiskColor = '#16a34a'; // Green
  let punctureRiskBg = 'rgba(22, 163, 74, 0.12)';

  if (punctureRiskScore >= 70) {
    punctureRiskLevel = 'CRITICAL';
    punctureRiskColor = '#dc2626'; // Red
    punctureRiskBg = 'rgba(220, 38, 38, 0.18)';
  } else if (punctureRiskScore >= 45) {
    punctureRiskLevel = 'HIGH';
    punctureRiskColor = '#ea580c'; // Orange
    punctureRiskBg = 'rgba(234, 88, 12, 0.16)';
  } else if (punctureRiskScore >= 22) {
    punctureRiskLevel = 'MODERATE';
    punctureRiskColor = '#d97706'; // Amber
    punctureRiskBg = 'rgba(217, 119, 6, 0.14)';
  }

  // Normalized component risk metrics for UI breakdown gauges
  const ageRisk = Math.min(1.0, Math.pow(tyreAge / Math.max(1, cliffLap), 1.7));
  const cliffRisk = Math.min(1.0, X_cliff);
  const thermalRisk = Math.min(1.0, X_thermal);
  const blisterRisk = Math.min(1.0, X_blister);
  const stressRisk = Math.min(1.0, X_stress);
  const speedRisk = Math.min(1.0, X_speed);

  return {
    gripLevel,
    treadRemaining,
    marginalDegRate,
    degRateFormatted,
    tyreEnergyLaps,
    tyreEnergyText,
    punctureRiskScore,
    punctureRiskLevel,
    punctureRiskColor,
    punctureRiskBg,
    survivalProbability: Math.round(survivalProb * 100),
    hazardRatio: parseFloat(hazardMultiplier.toFixed(2)),
    baselineHazard: parseFloat(H0.toFixed(3)),
    components: {
      ageRisk: Math.round(ageRisk * 100),
      cliffRisk: Math.round(cliffRisk * 100),
      thermalRisk: Math.round(thermalRisk * 100),
      blisterRisk: Math.round(blisterRisk * 100),
      stressRisk: Math.round(stressRisk * 100),
      speedRisk: Math.round(speedRisk * 100)
    }
  };
}
