/**
 * driverBehaviour.js — Driver Behaviour & Driving Style Analysis Layer
 * 
 * Analyzes rolling telemetry windows (throttle, brake, derivatives, overlap,
 * corner exits, and consistency) to estimate driving style, compute a 0-100
 * behaviour score, and provide bounded physical modifiers for tyre stress and thermal load.
 * 
 * Strict Principle: Explanatory & bounded physical modifier — NEVER replaces core tyre models.
 */

// ── Configuration Constants ───────────────────────────────────────
export const DRIVER_BEHAVIOUR_CONFIG = {
  // Feature weights (must sum to 1.0)
  WEIGHTS: {
    THROTTLE_AGGRESSION: 0.20,
    BRAKING_AGGRESSION: 0.20,
    INPUT_SHARPNESS: 0.15,
    THROTTLE_BRAKE_OVERLAP: 0.10,
    CORNER_EXIT_AGGRESSION: 0.20,
    INCONSISTENCY: 0.15,
  },

  // Score thresholds for state classification (0-100)
  THRESHOLDS: {
    CONSERVATIVE_MAX: 25,
    DEFENSIVE_MAX: 45,
    BALANCED_MAX: 60,
    ATTACK_MAX: 80,
    // OVERDRIVING > 80
  },

  // Tyre mechanical stress modifiers per state (strictly bounded: 0.97 - 1.10)
  STRESS_MODIFIERS: {
    CONSERVATIVE: 0.98,
    DEFENSIVE: 0.99,
    BALANCED: 1.00,
    ATTACK: 1.035,
    OVERDRIVING: 1.075,
  },

  // Thermal generation modifiers per state (strictly bounded: 0.98 - 1.06)
  THERMAL_MODIFIERS: {
    CONSERVATIVE: 0.98,
    DEFENSIVE: 0.99,
    BALANCED: 1.00,
    ATTACK: 1.03,
    OVERDRIVING: 1.06,
  },

  // Rolling buffer size (samples per window: ~100-150 samples represents 1-2 laps)
  BUFFER_CAPACITY: 120,

  // Confidence thresholds
  MIN_SAMPLES_FOR_CONFIDENCE: 25,
  FULL_CONFIDENCE_SAMPLES: 70,

  // Exponential moving average smoothing factor for score (prevents jitter)
  SCORE_SMOOTHING_ALPHA: 0.08,

  // Hysteresis cycle count required to flip state (prevents rapid flickering)
  HYSTERESIS_CYCLES: 15,
};

/**
 * Initialize a fresh driverBehaviour state object for a car.
 * @param {Object} [driverProfile] - Optional initial baseline traits
 * @returns {Object} Fresh driverBehaviour state
 */
export function createDriverBehaviourState(driverProfile = null) {
  const energyStrat = driverProfile?.energy?.deploymentStrategy || 'BALANCED';
  let initialScore = 50;
  let initialState = 'BALANCED';

  if (energyStrat === 'AGGRESSIVE') {
    initialScore = 65;
    initialState = 'ATTACK';
  } else if (energyStrat === 'CONSERVATIVE') {
    initialScore = 35;
    initialState = 'CONSERVATIVE';
  }

  return {
    score: initialScore,
    rawScore: initialScore,
    state: initialState,
    candidateState: initialState,
    candidateStateCycles: 0,

    // 6 Normalized Features (0.0 to 1.0)
    throttleAggression: 0.50,
    brakingAggression: 0.50,
    inputSharpness: 0.30,
    throttleBrakeOverlap: 0.05,
    cornerExitAggression: 0.50,
    inconsistency: 0.20,

    // Bounded Physical Modifiers
    tyreStressModifier: 1.00,
    thermalModifier: 1.00,

    // Confidence
    confidence: 'LOW',
    confidenceScore: 0.1,

    // Explanation
    explanation: 'Initializing driving style telemetry buffer...',

    // Rolling Data Buffers
    samples: [],
    lapSummaries: [],
    currentLapSamples: [],

    // Driver's Personal Baseline (tracks recent historical norms)
    baseline: {
      avgThrottle: 65,
      avgBrake: 12,
      inputVariance: 0.25,
      sampleCount: 0,
    },
  };
}

/**
 * Robustly clamp a number between min and max.
 */
function clamp(val, min, max) {
  if (isNaN(val) || !isFinite(val)) return min;
  return Math.max(min, Math.min(max, val));
}

/**
 * Extract the 6 normalized behavioural features from the rolling window.
 * 
 * @param {Array} samples - Rolling window of telemetry samples
 * @param {Object} baseline - Driver baseline
 * @param {Array} lapSummaries - Recent per-lap summary metrics
 * @returns {Object} Normalized 0-1 features
 */
export function extractDriverBehaviourFeatures(samples, baseline, lapSummaries) {
  if (!samples || samples.length < 5) {
    return {
      throttleAggression: 0.50,
      brakingAggression: 0.50,
      inputSharpness: 0.30,
      throttleBrakeOverlap: 0.05,
      cornerExitAggression: 0.50,
      inconsistency: 0.20,
    };
  }

  const n = samples.length;
  let sumThrottle = 0;
  let maxThrottle = 0;
  let highThrottleCount = 0;

  let sumBrake = 0;
  let maxBrake = 0;
  let heavyBrakeCount = 0;
  let brakingSamplesCount = 0;

  let overlapCount = 0;
  let throttleDerivAbsSum = 0;
  let brakeDerivAbsSum = 0;

  let cornerExitRampRates = [];

  for (let i = 0; i < n; i++) {
    const s = samples[i];
    const th = s.throttle !== undefined ? s.throttle : 0;
    const br = s.brake !== undefined ? s.brake : 0;

    sumThrottle += th;
    if (th > maxThrottle) maxThrottle = th;
    if (th >= 90) highThrottleCount++;

    sumBrake += br;
    if (br > maxBrake) maxBrake = br;
    if (br > 0.5) brakingSamplesCount++;
    if (br >= 3.0 || br >= 35) heavyBrakeCount++;

    // Simultaneous throttle & brake overlap
    // F1 drivers left-foot brake; normal trail-brake overlap is slight (>10% throttle + >2% brake)
    if (th > 15 && br > 1.0) {
      overlapCount++;
    }

    // Input derivatives
    if (i > 0) {
      const prev = samples[i - 1];
      const dt = Math.max(0.01, s.dt || 0.05);
      const dTh = Math.abs((th - (prev.throttle || 0)) / dt);
      const dBr = Math.abs((br - (prev.brake || 0)) / dt);
      throttleDerivAbsSum += dTh;
      brakeDerivAbsSum += dBr;

      // Corner Exit Aggression: detect release of brake followed by throttle application
      if ((prev.brake || 0) > 1.5 && br <= 0.5 && th > 20) {
        const rampRate = (th - (prev.throttle || 0)) / dt;
        if (rampRate > 0) cornerExitRampRates.push(rampRate);
      }
    }
  }

  const avgThrottle = sumThrottle / n;
  const highThrottlePct = highThrottleCount / n;
  const avgBrake = brakingSamplesCount > 0 ? (sumBrake / brakingSamplesCount) : 0;
  const heavyBrakePct = n > 0 ? (heavyBrakeCount / n) : 0;
  const overlapPct = overlapCount / n;

  const meanThrottleDeriv = throttleDerivAbsSum / (n - 1 || 1);
  const meanBrakeDeriv = brakeDerivAbsSum / (n - 1 || 1);

  // ── A. Throttle Aggression (0.0 to 1.0) ──
  // Compare against baseline throttle
  const baseAvgTh = baseline?.avgThrottle || 65;
  const throttleDelta = (avgThrottle - baseAvgTh) / 35.0; // [-1.0, 1.0]
  const rawThAgg = 0.40 * (avgThrottle / 100.0) + 0.35 * highThrottlePct + 0.25 * clamp(0.5 + throttleDelta * 0.5, 0, 1);
  const throttleAggression = clamp(rawThAgg, 0.0, 1.0);

  // ── B. Braking Aggression (0.0 to 1.0) ──
  // Evaluates peak brake, heavy braking share, and sharpness of brake application
  const normMaxBrake = clamp(maxBrake > 10 ? (maxBrake / 80.0) : (maxBrake / 5.0), 0, 1);
  const normAvgBrake = clamp(avgBrake > 10 ? (avgBrake / 45.0) : (avgBrake / 3.5), 0, 1);
  const normHeavyBrakePct = clamp(heavyBrakePct * 2.5, 0, 1);
  const rawBrAgg = 0.40 * normMaxBrake + 0.35 * normHeavyBrakePct + 0.25 * normAvgBrake;
  const brakingAggression = clamp(rawBrAgg, 0.0, 1.0);

  // ── C. Input Sharpness / Smoothness (0.0 to 1.0) ──
  // High variance / derivatives = abrupt, sharp, erratic inputs
  const normThDeriv = clamp(meanThrottleDeriv / 300.0, 0, 1);
  const normBrDeriv = clamp(meanBrakeDeriv / 20.0, 0, 1);
  const inputSharpness = clamp(0.55 * normThDeriv + 0.45 * normBrDeriv, 0.0, 1.0);

  // ── D. Throttle/Brake Overlap (0.0 to 1.0) ──
  // Normal overlap is 0.0 - 0.04 (scaled to ~0.1 - 0.2). Excessive overlap > 0.08 is high overdriving signal.
  const overlapScore = clamp(overlapPct * 8.0, 0.0, 1.0);

  // ── E. Corner Exit Aggression (0.0 to 1.0) ──
  let cornerExitAgg = 0.50;
  if (cornerExitRampRates.length > 0) {
    const avgRamp = cornerExitRampRates.reduce((a, b) => a + b, 0) / cornerExitRampRates.length;
    cornerExitAgg = clamp(avgRamp / 400.0, 0.0, 1.0);
  } else {
    // If no distinct corner exit detected in short window, fallback to high throttle share
    cornerExitAgg = clamp(0.3 + 0.7 * highThrottlePct, 0.0, 1.0);
  }

  // ── F. Lap-to-Lap Inconsistency (0.0 to 1.0) ──
  let inconsistency = 0.20; // Default nominal consistency
  if (lapSummaries && lapSummaries.length >= 2) {
    const recent = lapSummaries.slice(-3);
    const throttles = recent.map(l => l.avgThrottle || 65);
    const meanT = throttles.reduce((a, b) => a + b, 0) / throttles.length;
    const varT = throttles.reduce((a, b) => a + Math.pow(b - meanT, 2), 0) / throttles.length;
    const stdT = Math.sqrt(varT);
    const cv = meanT > 0 ? (stdT / meanT) : 0; // coefficient of variation
    inconsistency = clamp(cv * 6.0, 0.05, 1.0);
  }

  return {
    throttleAggression: Math.round(throttleAggression * 1000) / 1000,
    brakingAggression: Math.round(brakingAggression * 1000) / 1000,
    inputSharpness: Math.round(inputSharpness * 1000) / 1000,
    throttleBrakeOverlap: Math.round(overlapScore * 1000) / 1000,
    cornerExitAggression: Math.round(cornerExitAgg * 1000) / 1000,
    inconsistency: Math.round(inconsistency * 1000) / 1000,
  };
}

/**
 * Calculate the continuous 0–100 Driver Behaviour Score from normalized features.
 */
export function calculateDriverBehaviourScore(features) {
  const W = DRIVER_BEHAVIOUR_CONFIG.WEIGHTS;
  const weightedSum =
    (features.throttleAggression * W.THROTTLE_AGGRESSION) +
    (features.brakingAggression * W.BRAKING_AGGRESSION) +
    (features.inputSharpness * W.INPUT_SHARPNESS) +
    (features.throttleBrakeOverlap * W.THROTTLE_BRAKE_OVERLAP) +
    (features.cornerExitAggression * W.CORNER_EXIT_AGGRESSION) +
    (features.inconsistency * W.INCONSISTENCY);

  return clamp(Math.round(weightedSum * 1000) / 10, 0.0, 100.0);
}

/**
 * Multi-factor behavioural state classification with hysteresis.
 * Evaluates both the continuous score and the internal feature relationships.
 * 
 * @param {number} score - Current smoothed behaviour score (0-100)
 * @param {Object} features - Normalized feature bundle
 * @param {Object} car - Current car context (gaps, traffic, etc.)
 * @returns {string} One of 'CONSERVATIVE', 'DEFENSIVE', 'BALANCED', 'ATTACK', 'OVERDRIVING'
 */
export function classifyDriverBehaviour(score, features, car = null) {
  const T = DRIVER_BEHAVIOUR_CONFIG.THRESHOLDS;

  // 1. OVERDRIVING CHECK:
  // Must have elevated intensity PLUS evidence of loss of control / excessive overlap / erratic sharpness.
  // Hard braking alone does NOT cause overdriving.
  const hasSevereErraticInputs = (features.inputSharpness > 0.45 || features.throttleBrakeOverlap > 0.20 || features.inconsistency > 0.50);
  const isHighAggression = (features.throttleAggression > 0.65 && features.brakingAggression > 0.60);

  if ((score >= T.ATTACK_MAX && (hasSevereErraticInputs || isHighAggression)) || (score >= 65 && features.throttleBrakeOverlap > 0.25 && features.inputSharpness > 0.35)) {
    return 'OVERDRIVING';
  }

  // 2. ATTACK CHECK:
  // High score, aggressive throttle and corner exit, but controlled input sharpness.
  if (score >= T.BALANCED_MAX) {
    // If score is high (>80) but inputs are very smooth, classify as high ATTACK rather than overdriving
    return 'ATTACK';
  }

  // 3. BALANCED CHECK:
  if (score >= T.DEFENSIVE_MAX) {
    return 'BALANCED';
  }

  // 4. DEFENSIVE vs CONSERVATIVE:
  // Defensive driving is characterized by late/hard braking but restrained throttle on corner exit,
  // especially when a car behind is close (< 1.5s).
  const isCarBehindClose = car && car.gapBehindTime !== undefined && car.gapBehindTime < 1.5;
  const isBrakingHeavierThanThrottle = features.brakingAggression > (features.throttleAggression + 0.15);

  if (score >= T.CONSERVATIVE_MAX) {
    if (isCarBehindClose || isBrakingHeavierThanThrottle) {
      return 'DEFENSIVE';
    }
    return 'CONSERVATIVE';
  }

  // Under 25
  return 'CONSERVATIVE';
}

/**
 * Assess telemetry confidence for the behavioural estimate.
 */
export function calculateDriverBehaviourConfidence(samplesCount, currentLap, raceEvent = 'GREEN', isPitting = false) {
  if (isPitting || currentLap <= 1 || raceEvent === 'SC' || raceEvent === 'VSC') {
    return { level: 'LOW', score: 0.25 };
  }

  if (samplesCount < DRIVER_BEHAVIOUR_CONFIG.MIN_SAMPLES_FOR_CONFIDENCE) {
    return { level: 'LOW', score: clamp(samplesCount / DRIVER_BEHAVIOUR_CONFIG.MIN_SAMPLES_FOR_CONFIDENCE, 0.1, 0.4) };
  }

  if (samplesCount < DRIVER_BEHAVIOUR_CONFIG.FULL_CONFIDENCE_SAMPLES) {
    return { level: 'MEDIUM', score: 0.65 };
  }

  return { level: 'HIGH', score: 0.95 };
}

/**
 * Calculate bounded physical modifiers for tyre mechanical stress and thermal load.
 */
export function calculateDriverBehaviourModifiers(score, state) {
  const C = DRIVER_BEHAVIOUR_CONFIG;
  const baseStress = C.STRESS_MODIFIERS[state] || 1.00;
  const baseThermal = C.THERMAL_MODIFIERS[state] || 1.00;

  // Continuous fine-grain blending within state envelope:
  // Offset based on distance from neutral (50)
  const continuousStressDelta = (score - 50.0) * 0.0010; // ±0.05 max
  const continuousThermalDelta = (score - 50.0) * 0.0008; // ±0.04 max

  const tyreStressModifier = clamp(baseStress + continuousStressDelta * 0.5, 0.97, 1.10);
  const thermalModifier = clamp(baseThermal + continuousThermalDelta * 0.5, 0.98, 1.06);

  return {
    tyreStressModifier: Math.round(tyreStressModifier * 1000) / 1000,
    thermalModifier: Math.round(thermalModifier * 1000) / 1000,
  };
}

/**
 * Generate human-readable analytical explanation of dominant telemetry factors.
 */
export function getDriverBehaviourExplanation(state, score, features) {
  switch (state) {
    case 'OVERDRIVING':
      if (features.throttleBrakeOverlap > 0.12) {
        return 'Overdriving pattern: excessive throttle/brake overlap and violent directional corrections.';
      }
      return 'Overdriving detected: aggressive inputs combined with high throttle/brake variability.';

    case 'ATTACK':
      if (features.cornerExitAggression > 0.65) {
        return 'Attack style: maximum throttle commitment and aggressive corner exits elevating tyre shear stress.';
      }
      return 'Attack behaviour: high throttle application and late braking points over recent laps.';

    case 'DEFENSIVE':
      return 'Defensive style: deep late braking into corner entries with protected throttle application on exit.';

    case 'CONSERVATIVE':
      return 'Conservative management: progressive throttle ramp-up and smooth braking protecting tyre carcass.';

    case 'BALANCED':
    default:
      return "Balanced behaviour: throttle and braking patterns remain close to the driver's recent baseline.";
  }
}

/**
 * Main update function called on every simulation tick for a car.
 * 
 * @param {Object} car - The car object from simulation.js
 * @param {number} dt - Time step in seconds
 * @param {string} raceEvent - Current race state ('GREEN', 'SC', 'VSC')
 */
export function updateDriverBehaviour(car, dt = 0.05, raceEvent = 'GREEN') {
  if (!car) return;

  if (!car.driverBehaviour) {
    car.driverBehaviour = createDriverBehaviourState(car.setup);
  }

  const beh = car.driverBehaviour;
  const currentThrottle = car.throttle !== undefined ? car.throttle : 80;
  const currentBrake = car.brake !== undefined ? car.brake : 0;
  const currentSpeed = car.speed !== undefined ? car.speed : 120;
  const currentProgress = car.progress !== undefined ? car.progress : 0;

  // Append current frame telemetry sample
  beh.samples.push({
    throttle: currentThrottle,
    brake: currentBrake,
    speed: currentSpeed,
    progress: currentProgress,
    dt: dt,
    time: car.totalRaceTime || 0,
  });

  // Keep rolling buffer within capacity
  if (beh.samples.length > DRIVER_BEHAVIOUR_CONFIG.BUFFER_CAPACITY) {
    beh.samples.shift();
  }

  // Also collect per-lap samples to build lap-to-lap summaries
  beh.currentLapSamples.push({ throttle: currentThrottle, brake: currentBrake });

  // Detect lap transition to archive lap summary
  if (car.lastArchivedLap !== car.currentLap) {
    if (beh.currentLapSamples.length > 20) {
      const avgT = beh.currentLapSamples.reduce((a, s) => a + s.throttle, 0) / beh.currentLapSamples.length;
      const avgB = beh.currentLapSamples.reduce((a, s) => a + s.brake, 0) / beh.currentLapSamples.length;
      beh.lapSummaries.push({
        lap: car.lastArchivedLap || car.currentLap - 1,
        avgThrottle: avgT,
        avgBrake: avgB,
      });
      if (beh.lapSummaries.length > 5) beh.lapSummaries.shift();

      // Slowly adapt baseline
      beh.baseline.avgThrottle = (beh.baseline.avgThrottle * 0.90) + (avgT * 0.10);
      beh.baseline.avgBrake = (beh.baseline.avgBrake * 0.90) + (avgB * 0.10);
    }
    beh.currentLapSamples = [];
    car.lastArchivedLap = car.currentLap;
  }

  // 1. Extract 6 normalized features
  const features = extractDriverBehaviourFeatures(beh.samples, beh.baseline, beh.lapSummaries);
  beh.throttleAggression = features.throttleAggression;
  beh.brakingAggression = features.brakingAggression;
  beh.inputSharpness = features.inputSharpness;
  beh.throttleBrakeOverlap = features.throttleBrakeOverlap;
  beh.cornerExitAggression = features.cornerExitAggression;
  beh.inconsistency = features.inconsistency;

  // 2. Compute Raw Score
  const rawScore = calculateDriverBehaviourScore(features);
  beh.rawScore = rawScore;

  // 3. Apply EMA smoothing (unconditionally smooth transitions)
  const alpha = DRIVER_BEHAVIOUR_CONFIG.SCORE_SMOOTHING_ALPHA;
  beh.score = Math.round(((beh.score * (1.0 - alpha)) + (rawScore * alpha)) * 10) / 10;

  // 4. Candidate State Classification & Hysteresis
  const candidateState = classifyDriverBehaviour(beh.score, features, car);
  if (candidateState === beh.state) {
    beh.candidateState = candidateState;
    beh.candidateStateCycles = 0;
  } else {
    if (candidateState === beh.candidateState) {
      beh.candidateStateCycles++;
      if (beh.candidateStateCycles >= DRIVER_BEHAVIOUR_CONFIG.HYSTERESIS_CYCLES) {
        beh.state = candidateState;
        beh.candidateStateCycles = 0;
      }
    } else {
      beh.candidateState = candidateState;
      beh.candidateStateCycles = 1;
    }
  }

  // 5. Calculate Bounded Stress & Thermal Modifiers
  const modifiers = calculateDriverBehaviourModifiers(beh.score, beh.state);
  beh.tyreStressModifier = modifiers.tyreStressModifier;
  beh.thermalModifier = modifiers.thermalModifier;

  // 6. Confidence Assessment
  const conf = calculateDriverBehaviourConfidence(beh.samples.length, car.currentLap || 1, raceEvent, car.isPitting);
  beh.confidence = conf.level;
  beh.confidenceScore = conf.score;

  // 7. Dynamic Explanation
  beh.explanation = getDriverBehaviourExplanation(beh.state, beh.score, features);

  return beh;
}
