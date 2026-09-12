/**
 * dynamicDegradation.js — Dynamic Degradation Rate + Acceleration Engine
 * 
 * Tracks the live rate of tyre degradation and its first derivative (acceleration in s/lap²).
 * Implements exponential moving average (EMA) smoothing and lap-window regression
 * to distinguish transient sensor/traffic noise from genuine thermal breakdown and tyre cliffing.
 */

import { getMarginalDegRate } from './strategy.js';

// Trend classifications
export const DEG_TRENDS = {
  IMPROVING: 'IMPROVING',
  STABLE: 'STABLE',
  DEGRADING: 'DEGRADING',
  ACCELERATING: 'ACCELERATING',
  SEVERE: 'SEVERE ACCELERATION'
};

/**
 * Updates or initializes the dynamic degradation state of a car.
 *
 * @param {Object} car - Live simulated car object
 * @param {number} dt - Frame delta time in seconds
 * @returns {Object} Updated dynamic degradation metrics
 */
export function updateDynamicDegradation(car, dt = 0.05) {
  const compound = car.compound || 'MEDIUM';
  const tyreAge = Math.max(0, car.tyreAge || 0);
  const setup = car.setup || null;

  // Initialize car-level dynamic degradation buffer if not present
  if (!car.dynamicDegradationState) {
    car.dynamicDegradationState = {
      smoothedRate: null,
      previousLapRates: [],
      lastRecordedAge: tyreAge,
      lastUpdateTime: 0,
      acceleration: 0.003,
      historyTrace: []
    };
  }

  const dState = car.dynamicDegradationState;

  // 1. Authoritative base degradation rate (s/lap)
  const baseMarginalRate = getMarginalDegRate(compound, tyreAge, setup);

  // 2. Add instantaneous thermal penalty contribution to effective lap degradation rate
  // As tyres overheat, the thermal penalty adds directly to the lap degradation slope
  const thermalPenalty = car.thermalState?.thermalPenalty || 0;
  // Scale thermal penalty into marginal lap penalty (~10% of instantaneous penalty adds to wear slope)
  const effectiveThermalSlope = thermalPenalty * 0.12;

  // Driver behaviour modifier
  const behMod = car.driverBehaviour?.tyreStressModifier || 1.0;

  // Instantaneous dynamic degradation rate: D(t)
  const currentInstantRate = (baseMarginalRate + effectiveThermalSlope) * behMod;

  // 3. EMA Smoothing: D_smoothed(t) = α * D_current + (1 - α) * D_smoothed(t-1)
  // Adaptive alpha: smooths frame-by-frame while keeping high reactivity across laps
  const alpha = 0.12;
  if (dState.smoothedRate === null) {
    dState.smoothedRate = currentInstantRate;
  } else {
    dState.smoothedRate = (alpha * currentInstantRate) + ((1 - alpha) * dState.smoothedRate);
  }

  // 4. Lap-Crossing History Tracking
  // When tyre age increments, commit the smoothed rate to historical window
  if (tyreAge !== dState.lastRecordedAge) {
    dState.previousLapRates.push({
      lapAge: dState.lastRecordedAge,
      rate: Number(dState.smoothedRate.toFixed(3))
    });
    if (dState.previousLapRates.length > 5) {
      dState.previousLapRates.shift();
    }
    dState.lastRecordedAge = tyreAge;
  }

  // 5. Acceleration Calculation: A(t) = (D_current - D_previous) / Δlaps (s/lap²)
  let acceleration = 0.003; // Nominal gentle linear acceleration
  const hist = dState.previousLapRates;

  if (hist.length >= 2) {
    const k = Math.min(3, hist.length - 1);
    const pastEntry = hist[hist.length - 1 - k];
    const currentRate = dState.smoothedRate;
    const deltaLaps = Math.max(1, tyreAge - pastEntry.lapAge);
    acceleration = (currentRate - pastEntry.rate) / deltaLaps;
  } else {
    // Before completing multiple laps, derive acceleration from thermal trajectory & quadratic fit
    const deltaT = car.thermalState?.deltaT || 0;
    if (deltaT > 8.0) {
      acceleration = 0.018 + (deltaT - 8.0) * 0.002;
    } else if (car.compound === 'SOFT') {
      acceleration = 0.008;
    } else {
      acceleration = 0.004;
    }
  }

  // Numerical sanity bounds on acceleration: [-0.05, 0.15] s/lap²
  acceleration = Math.max(-0.05, Math.min(0.15, acceleration));
  dState.acceleration = acceleration;

  // 6. Trend Classification based on relative magnitude
  // Compare acceleration against base degradation scale
  const normBase = Math.max(0.03, baseMarginalRate);
  const relativeAccelRatio = acceleration / normBase;

  let trend = DEG_TRENDS.STABLE;
  let trendSymbol = '→';
  let trendColor = 'var(--green)';

  if (acceleration < -0.006) {
    trend = DEG_TRENDS.IMPROVING;
    trendSymbol = '↓';
    trendColor = 'var(--cyan)';
  } else if (acceleration > 0.035 || relativeAccelRatio > 0.45) {
    trend = DEG_TRENDS.SEVERE;
    trendSymbol = '⇈';
    trendColor = 'var(--red)';
  } else if (acceleration > 0.014 || relativeAccelRatio > 0.20) {
    trend = DEG_TRENDS.ACCELERATING;
    trendSymbol = '↑';
    trendColor = 'var(--amber)';
  } else if (acceleration > 0.005) {
    trend = DEG_TRENDS.DEGRADING;
    trendSymbol = '↗';
    trendColor = 'var(--color-carbon)';
  } else {
    trend = DEG_TRENDS.STABLE;
    trendSymbol = '→';
    trendColor = 'var(--green)';
  }

  // 7. Recent History Trace (e.g. 0.051 → 0.061 → 0.078)
  let historyTraceStr = '';
  if (hist.length >= 2) {
    const recent = hist.slice(-3).map(h => h.rate.toFixed(3));
    if (!recent.includes(dState.smoothedRate.toFixed(3))) {
      recent.push(dState.smoothedRate.toFixed(3));
    }
    historyTraceStr = recent.slice(-3).join(' → ');
  } else {
    const prevEstimate1 = Math.max(0.01, dState.smoothedRate - acceleration * 2).toFixed(3);
    const prevEstimate2 = Math.max(0.01, dState.smoothedRate - acceleration * 1).toFixed(3);
    historyTraceStr = `${prevEstimate1} → ${prevEstimate2} → ${dState.smoothedRate.toFixed(3)}`;
  }

  // Formatted outputs
  const currentRateRounded = Number(dState.smoothedRate.toFixed(3));
  const rateFormatted = `${currentRateRounded >= 0 ? '+' : ''}${currentRateRounded.toFixed(3)} s/lap`;
  const accelFormatted = `${acceleration >= 0 ? '+' : ''}${acceleration.toFixed(3)} s/lap²`;

  const result = {
    currentRate: currentRateRounded,
    rateFormatted,
    acceleration: Number(acceleration.toFixed(3)),
    accelFormatted,
    trend,
    trendSymbol,
    trendColor,
    historyTrace: historyTraceStr,
    isAccelerating: trend === DEG_TRENDS.ACCELERATING || trend === DEG_TRENDS.SEVERE,
    isSevere: trend === DEG_TRENDS.SEVERE
  };

  car.dynamicDegradation = result;
  return result;
}
