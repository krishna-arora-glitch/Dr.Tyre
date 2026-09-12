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

  // ── E. PUNCTURE RISK ESTIMATION (0-100 Score) ──
  // 1. AgeRisk: progressive power function of tyreAge / cliffLap
  const ageRatio = tyreAge / Math.max(1, cliffLap);
  const ageRisk = Math.min(1.0, Math.pow(ageRatio, 1.7));

  // 2. CliffRisk: increases sharply as car nears and crosses cliff
  let cliffRisk = 0.0;
  if (tyreAge >= cliffLap) {
    cliffRisk = Math.min(1.0, 0.60 + 0.40 * ((tyreAge - cliffLap) / Math.max(3, cliffLap * 0.25)));
  } else if (tyreAge >= cliffLap - 4) {
    cliffRisk = 0.15 + 0.45 * ((tyreAge - (cliffLap - 4)) / 4.0);
  } else if (tyreAge >= cliffLap - 8) {
    cliffRisk = 0.05 + 0.10 * ((tyreAge - (cliffLap - 8)) / 4.0);
  }

  // 3. ThermalRisk: based on temperature above optimal window
  let thermalRisk = 0.0;
  if (tyreTemp > win.opt) {
    const tSpan = Math.max(6, win.blister - win.opt);
    if (tyreTemp <= win.blister) {
      thermalRisk = 0.60 * ((tyreTemp - win.opt) / tSpan);
    } else {
      thermalRisk = Math.min(1.0, 0.60 + 0.40 * ((tyreTemp - win.blister) / 8.0));
    }
  }

  // 4. BlisterRisk: severe structural degradation once blistering begins
  let blisterRisk = 0.0;
  if (tyreTemp > win.blister) {
    blisterRisk = Math.min(1.0, (blisterFactor - 1.0) / 2.5);
  }

  // 5. StressRisk: based on LapStress
  const stressRisk = Math.max(0, Math.min(1.0, (lapStress + 0.4) / 1.5));

  // 6. HighSpeedLoadRisk: sustained centrifugal carcass stress
  const speedRisk = Math.max(0, Math.min(1.0, (speed - 160) / 140.0));

  // Configurable weights summing to 1.00
  const w_age = 0.20;
  const w_cliff = 0.25;
  const w_thermal = 0.20;
  const w_blister = 0.15;
  const w_stress = 0.10;
  const w_speed = 0.10;

  const rawPunctureRisk = 100 * (
    (w_age * ageRisk) +
    (w_cliff * cliffRisk) +
    (w_thermal * thermalRisk) +
    (w_blister * blisterRisk) +
    (w_stress * stressRisk) +
    (w_speed * speedRisk)
  );

  // Baseline F1 running has ~3-5% structural hazard floor, clamped at 95%
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
