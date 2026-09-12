/**
 * predictionConfidence.js — Prediction Confidence Score Engine
 * 
 * Computes an authoritative, transparent confidence score [0, 100]
 * for any strategic or physical prediction in Dr.Tyre.
 * 
 * Sit cleanly ABOVE existing models:
 *   FastF1 / ML -> LME -> Thermal -> Stress -> Driver -> 2026 Reg -> Strategy -> CONFIDENCE ENGINE -> UI
 * 
 * Evidence Factors:
 *   - Model Certainty (30%): From 95% Confidence Interval width (getDegradationUncertainty)
 *   - Telemetry Quality (20%): Number of valid clean laps observed in current stint
 *   - Trend Stability (15%): Lap degradation consistency / low variance
 *   - Traffic Certainty (10%): Pit-exit traffic window and clean air predictability
 *   - Thermal Stability (10%): Tyre temperature closeness to optimal window
 *   - Driver Behaviour Stability (5%): Driver smoothness and pattern consistency
 *   - Strategic Margin (10%): Advantage gap between top recommendation and runner-up
 * 
 * Levels:
 *   - HIGH (80–100%)
 *   - MEDIUM (60–79%)
 *   - LOW (0–59%)
 */

import { getDegradationUncertainty, COMPOUND_THERMAL_WINDOWS } from './strategy.js';

/**
 * Configurable weights for prediction confidence factors.
 */
export const CONFIDENCE_WEIGHTS = {
  modelCertainty: 0.30,
  telemetryQuality: 0.20,
  trendStability: 0.15,
  trafficCertainty: 0.10,
  thermalStability: 0.10,
  driverBehaviourStability: 0.05,
  strategicMargin: 0.10
};

/**
 * Evaluates prediction confidence for a given prediction context.
 * 
 * @param {Object} context - Prediction context containing telemetry and model parameters
 * @returns {Object} Prediction confidence report
 */
export function calculatePredictionConfidence(context = {}) {
  const compound = context.compound || 'MEDIUM';
  const tyreAge = Math.max(0, context.tyreAge || 0);
  const setup = context.setup || null;
  const thermalState = context.thermalState || null;
  const lapsObserved = (context.lapsObserved !== undefined) ? context.lapsObserved : tyreAge;
  const trafficRisk = context.trafficRisk || 'LOW';
  const driverBehaviour = context.driverBehaviour || null;
  const strategicMarginSec = (context.strategicMarginSec !== undefined)
    ? context.strategicMarginSec
    : (context.candidateDeltaBest !== undefined ? context.candidateDeltaBest : 1.5);
  const dynamicDegradation = context.dynamicDegradation || null;

  // ─────────────────────────────────────────────────────────────
  // 1. COMPONENT A: MODEL CERTAINTY (0–100)
  // ─────────────────────────────────────────────────────────────
  // Narrower 95% CI from LME model produces higher certainty.
  const degUncertainty = (context.uncertaintyBand !== undefined)
    ? context.uncertaintyBand
    : (getDegradationUncertainty(compound, tyreAge, setup) || 0.015);

  // CI bounds: <= 0.015 s/lap -> 100 certainty; >= 0.150 s/lap -> 15 certainty
  let modelCertainty = 85;
  if (degUncertainty <= 0.015) {
    modelCertainty = 100;
  } else if (degUncertainty >= 0.150) {
    modelCertainty = 15;
  } else {
    // Linear scale between 0.015 and 0.150
    modelCertainty = Math.round(100 - ((degUncertainty - 0.015) / (0.150 - 0.015)) * 85);
  }

  // ─────────────────────────────────────────────────────────────
  // 2. COMPONENT B: TELEMETRY QUALITY & SAMPLE DENSITY (0–100)
  // ─────────────────────────────────────────────────────────────
  // Early in the stint, few clean laps have been observed -> lower confidence.
  let telemetryQuality = 35;
  if (lapsObserved <= 1) {
    telemetryQuality = 25;
  } else if (lapsObserved === 2) {
    telemetryQuality = 35;
  } else if (lapsObserved <= 4) {
    telemetryQuality = 50;
  } else if (lapsObserved <= 7) {
    telemetryQuality = 68;
  } else if (lapsObserved <= 12) {
    telemetryQuality = 82;
  } else {
    telemetryQuality = Math.min(100, Math.round(85 + (lapsObserved - 12) * 1.5));
  }

  // ─────────────────────────────────────────────────────────────
  // 3. COMPONENT C: DEGRADATION TREND STABILITY (0–100)
  // ─────────────────────────────────────────────────────────────
  // Check whether recent lap pace loss is smooth or erratic.
  let trendStability = 80;
  if (Array.isArray(context.recentLapsDeg) && context.recentLapsDeg.length >= 3) {
    const arr = context.recentLapsDeg;
    let diffs = [];
    for (let i = 1; i < arr.length; i++) {
      diffs.push(arr[i] - arr[i - 1]);
    }
    let meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    let variance = diffs.reduce((a, b) => a + Math.pow(b - meanDiff, 2), 0) / diffs.length;
    let stdDev = Math.sqrt(variance);
    if (stdDev <= 0.008) {
      trendStability = 95;
    } else if (stdDev <= 0.020) {
      trendStability = 82;
    } else if (stdDev <= 0.045) {
      trendStability = 60;
    } else {
      trendStability = Math.max(20, Math.round(50 - (stdDev - 0.045) * 600));
    }
  } else {
    const accel = Math.abs(dynamicDegradation?.acceleration || 0.005);
    if (accel <= 0.005) {
      trendStability = 95;
    } else if (accel <= 0.012) {
      trendStability = 82;
    } else if (accel <= 0.025) {
      trendStability = 60;
    } else {
      trendStability = Math.max(20, Math.round(50 - (accel - 0.025) * 800));
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 4. COMPONENT D: TRAFFIC CERTAINTY (0–100)
  // ─────────────────────────────────────────────────────────────
  // Clear air and predictable pit exit provide higher strategic certainty.
  let trafficCertainty = 85;
  const normTraffic = String(trafficRisk).toUpperCase();
  if (normTraffic.includes('LOW') || normTraffic.includes('CLEAR')) {
    trafficCertainty = 92;
  } else if (normTraffic.includes('MED')) {
    trafficCertainty = 64;
  } else {
    // HIGH or contested traffic packet
    trafficCertainty = 36;
  }

  // ─────────────────────────────────────────────────────────────
  // 5. COMPONENT E: TYRE TEMPERATURE STABILITY (0–100)
  // ─────────────────────────────────────────────────────────────
  // Temperatures within the operating window ensure physical stability.
  const win = COMPOUND_THERMAL_WINDOWS[compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
  const tyreTemp = (thermalState?.tyreTemp !== undefined) ? thermalState.tyreTemp : 100;
  const deltaFromOpt = Math.abs(tyreTemp - win.opt);
  let thermalStability = 80;

  if (tyreTemp > win.blister) {
    thermalStability = 25; // Blistering introduces high thermal volatility
  } else if (deltaFromOpt <= 3.0) {
    thermalStability = 96; // Right in the sweet spot
  } else if (deltaFromOpt <= 8.0) {
    thermalStability = 80;
  } else if (deltaFromOpt <= 14.0) {
    thermalStability = 58;
  } else {
    thermalStability = Math.max(30, Math.round(50 - (deltaFromOpt - 14.0) * 3));
  }

  // ─────────────────────────────────────────────────────────────
  // 6. COMPONENT F: DRIVER BEHAVIOUR STABILITY (0–100)
  // ─────────────────────────────────────────────────────────────
  // Reuses driverBehaviour layer without duplicate models.
  let driverBehaviourStability = 75;
  if (driverBehaviour) {
    if (typeof driverBehaviour.smoothnessScore === 'number' && !isNaN(driverBehaviour.smoothnessScore)) {
      driverBehaviourStability = Math.min(100, Math.max(30, Math.round(driverBehaviour.smoothnessScore)));
    } else if (typeof driverBehaviour.score === 'number' && !isNaN(driverBehaviour.score)) {
      driverBehaviourStability = Math.min(100, Math.max(30, Math.round(driverBehaviour.score)));
    } else if (typeof driverBehaviour.confidence === 'number' && !isNaN(driverBehaviour.confidence)) {
      driverBehaviourStability = Math.min(100, Math.max(30, Math.round(driverBehaviour.confidence)));
    } else if (typeof driverBehaviour.confidence === 'string') {
      const c = driverBehaviour.confidence.toUpperCase();
      driverBehaviourStability = c === 'HIGH' ? 90 : (c === 'MEDIUM' ? 72 : 50);
    } else if (driverBehaviour.state === 'CONSISTENT' || driverBehaviour.state === 'SMOOTH' || driverBehaviour.state === 'BALANCED') {
      driverBehaviourStability = 90;
    } else if (driverBehaviour.state === 'OVERDRIVING' || driverBehaviour.state === 'AGGRESSIVE') {
      driverBehaviourStability = 45;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 7. COMPONENT G: STRATEGIC MARGIN (0–100)
  // ─────────────────────────────────────────────────────────────
  // A decisive time delta between competing strategies increases confidence.
  // When alternatives are neck-and-neck (e.g. gain < 0.2s), confidence is lower.
  let strategicMarginScore = 75;
  const marginSec = Math.abs(strategicMarginSec);
  if (marginSec >= 3.0) {
    strategicMarginScore = 98;
  } else if (marginSec >= 1.5) {
    strategicMarginScore = 84;
  } else if (marginSec >= 0.7) {
    strategicMarginScore = 68;
  } else if (marginSec >= 0.25) {
    strategicMarginScore = 52;
  } else {
    strategicMarginScore = 32; // Negligible difference between options
  }

  // ─────────────────────────────────────────────────────────────
  // 8. WEIGHTED CONFIDENCE SCORE AGGREGATION
  // ─────────────────────────────────────────────────────────────
  const rawScore =
    CONFIDENCE_WEIGHTS.modelCertainty * modelCertainty +
    CONFIDENCE_WEIGHTS.telemetryQuality * telemetryQuality +
    CONFIDENCE_WEIGHTS.trendStability * trendStability +
    CONFIDENCE_WEIGHTS.trafficCertainty * trafficCertainty +
    CONFIDENCE_WEIGHTS.thermalStability * thermalStability +
    CONFIDENCE_WEIGHTS.driverBehaviourStability * driverBehaviourStability +
    CONFIDENCE_WEIGHTS.strategicMargin * strategicMarginScore;

  // Strict bounding [0, 100]
  let score = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Section 13: Early in the race or stint, confidence should naturally be lower:
  // Lap 1: LOW, Lap 2: LOW, Lap 5: MEDIUM, Lap 10: HIGH
  if (lapsObserved <= 1) {
    score = Math.min(score, 54);
  } else if (lapsObserved === 2) {
    score = Math.min(score, 58);
  } else if (lapsObserved <= 5) {
    score = Math.min(score, 74);
  }

  // Bounded level classification
  const level = score >= 80 ? 'HIGH' : (score >= 60 ? 'MEDIUM' : 'LOW');

  // ─────────────────────────────────────────────────────────────
  // 9. EVIDENCE-BASED HUMAN-READABLE REASONS
  // ─────────────────────────────────────────────────────────────
  const reasons = [];

  if (telemetryQuality >= 80) {
    reasons.push(`High telemetry coverage (${lapsObserved} clean stint laps).`);
  } else if (telemetryQuality <= 40) {
    reasons.push(`Early stint observation (${lapsObserved} laps recorded); telemetry density accumulating.`);
  }

  if (modelCertainty >= 85) {
    reasons.push(`Narrow LME model degradation uncertainty (±${degUncertainty.toFixed(3)} s/lap).`);
  } else if (modelCertainty <= 50) {
    reasons.push(`Wider model variance across compound baseline (±${degUncertainty.toFixed(3)} s/lap).`);
  }

  if (trendStability >= 85) {
    reasons.push('Degradation rate demonstrates a stable, predictable slope.');
  } else if (trendStability <= 50) {
    reasons.push('Recent lap deltas exhibit non-linear degradation acceleration.');
  }

  if (trafficCertainty <= 45) {
    reasons.push('Pit-exit window involves contested track packets or traffic uncertainty.');
  } else if (trafficCertainty >= 85) {
    reasons.push('Pit-exit window projected into clear air with minimal rejoin traffic.');
  }

  if (thermalStability <= 40) {
    reasons.push(`Tyre temperature (${Math.round(tyreTemp)}°C) elevated above optimal window (${win.opt}°C).`);
  }

  if (strategicMarginScore <= 40) {
    reasons.push(`Top strategy alternatives are within ${marginSec.toFixed(2)}s; decision margin is narrow.`);
  }

  return {
    score,
    level,
    uncertainty: Number(degUncertainty.toFixed(3)),
    components: {
      modelCertainty,
      telemetryQuality,
      trendStability,
      trafficCertainty,
      thermalStability,
      driverBehaviourStability,
      strategicMargin: strategicMarginScore
    },
    reasons
  };
}

/**
 * Creates an Exponential Moving Average (EMA) smoother for live telemetry confidence.
 * Prevents jitter between frame ticks while ensuring responsiveness to genuine shifts.
 * 
 * @param {number} alpha - Smoothing factor [0, 1]. Default 0.25
 * @returns {Function} Smoother function (newVal) => smoothedVal
 */
export function createConfidenceSmoother(alpha = 0.25) {
  let smoothed = null;
  const fn = function (newVal) {
    if (smoothed === null) {
      smoothed = newVal;
    } else {
      smoothed = smoothed * (1.0 - alpha) + newVal * alpha;
    }
    return Math.round(smoothed);
  };
  fn.smooth = fn;
  fn.reset = () => { smoothed = null; };
  return fn;
}
