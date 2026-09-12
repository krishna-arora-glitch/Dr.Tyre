/**
 * test_prediction_confidence.js
 * Comprehensive automated test suite for Dr.Tyre Prediction Confidence Engine.
 */

import { 
  calculatePredictionConfidence, 
  CONFIDENCE_WEIGHTS, 
  createConfidenceSmoother 
} from './predictionConfidence.js';

import { initStrategy, getPrescription, getDegradationUncertainty } from './strategy.js';
import { computeTyreHealth } from './tyreHealth.js';
import { evaluateOpponentIntent } from './opponentIntent.js';
import { evaluateInformationValue } from './informationValue.js';

console.log('====================================================');
console.log('🧪 RUNNING PREDICTION CONFIDENCE TEST SUITE');
console.log('====================================================\n');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passCount++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failCount++;
  }
}

// ── TEST 1: authoritativeness, structure & bounds ──
console.log('TEST 1: calculatePredictionConfidence output structure & bounds [0, 100]');
const baseContext = {
  compound: 'MEDIUM',
  tyreAge: 12,
  lapsObserved: 12,
  uncertaintyBand: 0.015,
  recentLapsDeg: [0.090, 0.092, 0.093, 0.095],
  trafficRisk: 'LOW',
  thermalState: { tyreTemp: 100, optimalTemp: 100, thermalPenalty: 0.0 },
  driverBehaviour: { score: 85, state: 'BALANCED', confidence: 'HIGH' },
  candidateDeltaBest: 2.5
};

const res1 = calculatePredictionConfidence(baseContext);
assert(typeof res1.score === 'number' && !isNaN(res1.score), 'score is valid number');
assert(res1.score >= 0 && res1.score <= 100, `score bounded 0 <= ${res1.score} <= 100`);
assert(['HIGH', 'MEDIUM', 'LOW'].includes(res1.level), `level is HIGH/MEDIUM/LOW (${res1.level})`);
assert(Array.isArray(res1.reasons) && res1.reasons.length > 0, `reasons array populated (${res1.reasons.length} reasons)`);
assert(typeof res1.components === 'object', 'components breakdown provided');

// ── TEST 2: Confidence Levels mapping ──
console.log('\nTEST 2: Confidence Levels (HIGH: 80-100, MEDIUM: 60-79, LOW: 0-59)');
assert(calculatePredictionConfidence({ ...baseContext, lapsObserved: 20, uncertaintyBand: 0.008 }).score >= 80, 'Optimal data yields HIGH (>=80)');
assert(calculatePredictionConfidence({ ...baseContext, lapsObserved: 1, uncertaintyBand: 0.16 }).score < 60, 'Lap 1 wide CI yields LOW (<60)');

// ── TEST 3: Telemetry Density & Progression (Lap 1 < Lap 5 < Lap 15) ──
console.log('\nTEST 3: Telemetry Sample Density progression over stint');
const lap1Conf = calculatePredictionConfidence({ ...baseContext, lapsObserved: 1, tyreAge: 1 });
const lap5Conf = calculatePredictionConfidence({ ...baseContext, lapsObserved: 5, tyreAge: 5 });
const lap15Conf = calculatePredictionConfidence({ ...baseContext, lapsObserved: 15, tyreAge: 15 });

assert(lap1Conf.score < lap5Conf.score, `Lap 1 (${lap1Conf.score}%) < Lap 5 (${lap5Conf.score}%)`);
assert(lap5Conf.score < lap15Conf.score, `Lap 5 (${lap5Conf.score}%) < Lap 15 (${lap15Conf.score}%)`);
assert(lap1Conf.level === 'LOW', `Early lap 1 produces LOW confidence (${lap1Conf.level})`);

// ── TEST 4: Model Uncertainty (Narrow CI vs Wide CI) ──
console.log('\nTEST 4: Degradation Model Uncertainty (Narrow CI vs Wide CI)');
const narrowCI = calculatePredictionConfidence({ ...baseContext, uncertaintyBand: 0.010 });
const wideCI = calculatePredictionConfidence({ ...baseContext, uncertaintyBand: 0.120 });
assert(narrowCI.score > wideCI.score, `Narrow CI (${narrowCI.score}%) > Wide CI (${wideCI.score}%)`);

// ── TEST 5: Degradation Trend Stability ──
console.log('\nTEST 5: Degradation Trend Stability (Linear vs Volatile)');
const stableTrend = calculatePredictionConfidence({ ...baseContext, recentLapsDeg: [0.088, 0.090, 0.092, 0.094] });
const erraticTrend = calculatePredictionConfidence({ ...baseContext, recentLapsDeg: [0.040, 0.140, 0.030, 0.180] });
assert(stableTrend.score > erraticTrend.score, `Stable trend (${stableTrend.score}%) > Erratic trend (${erraticTrend.score}%)`);

// ── TEST 6: Traffic Uncertainty ──
console.log('\nTEST 6: Traffic Impact');
const cleanTrack = calculatePredictionConfidence({ ...baseContext, trafficRisk: 'LOW' });
const dirtyTrack = calculatePredictionConfidence({ ...baseContext, trafficRisk: 'HIGH' });
assert(cleanTrack.score > dirtyTrack.score, `Clean track (${cleanTrack.score}%) > Contested traffic (${dirtyTrack.score}%)`);

// ── TEST 7: Tyre Thermal Stability ──
console.log('\nTEST 7: Tyre Thermal Stability');
const optTemp = calculatePredictionConfidence({ ...baseContext, thermalState: { tyreTemp: 100, optimalTemp: 100, thermalPenalty: 0.0 } });
const overTemp = calculatePredictionConfidence({ ...baseContext, thermalState: { tyreTemp: 122, optimalTemp: 100, thermalPenalty: 0.7 } });
assert(optTemp.score > overTemp.score, `In-window temp (${optTemp.score}%) > Overheating temp (${overTemp.score}%)`);

// ── TEST 8: Strategic Margin ──
console.log('\nTEST 8: Strategic Margin Impact');
const bigGain = calculatePredictionConfidence({ ...baseContext, candidateDeltaBest: 3.5 });
const razorGain = calculatePredictionConfidence({ ...baseContext, candidateDeltaBest: 0.05 });
assert(bigGain.score > razorGain.score, `Large gain margin (${bigGain.score}%) > Tiny gain margin (${razorGain.score}%)`);

// ── TEST 9: Smoothing EMA Filter ──
console.log('\nTEST 9: Confidence Smoother (Anti-Jitter EMA)');
const smoother = createConfidenceSmoother(0.3);
let s1 = smoother.smooth(50);
let s2 = smoother.smooth(80);
let s3 = smoother.smooth(82);
assert(s1 === 50, `First sample is initialized directly (${s1})`);
assert(s2 > 50 && s2 < 80, `Smoother damps jump (${s2})`);
assert(s3 > s2, `Smoother smoothly tracks upward (${s3})`);

// ── TEST 10: Integration with Tyre Health Engine ──
console.log('\nTEST 10: Integration with Tyre Health Engine');
const mockCar = {
  compound: 'MEDIUM',
  tyreAge: 14,
  thermalState: { tyreTemp: 101, optimalTemp: 100 },
  driverBehaviour: { score: 80, state: 'BALANCED', confidence: 'HIGH' }
};
const health = computeTyreHealth(mockCar);
assert(typeof health.degConfidenceScore === 'number', `degConfidenceScore present: ${health.degConfidenceScore}%`);
assert(typeof health.degConfidenceLevel === 'string', `degConfidenceLevel present: ${health.degConfidenceLevel}`);
assert(health.degRateFormatted.includes('±'), `degRateFormatted includes ±uncertainty: ${health.degRateFormatted}`);
assert(typeof health.gripConfidenceScore === 'number', `gripConfidenceScore present: ${health.gripConfidenceScore}%`);
assert(typeof health.treadConfidenceScore === 'number', `treadConfidenceScore present: ${health.treadConfidenceScore}%`);

// ── TEST 11: Integration with Opponent Intent Engine ──
console.log('\nTEST 11: Integration with Opponent Intent Engine');
const mockOppCar = {
  number: 16,
  driverName: 'LEC',
  compound: 'MEDIUM',
  tyreAge: 22,
  fuelPct: 40,
  thermalState: { tyreTemp: 104, optimalTemp: 100 },
  driverBehaviour: { score: 75, state: 'ATTACK', confidence: 'MEDIUM' }
};
const oppIntent = evaluateOpponentIntent(mockOppCar, mockCar, 22, 61, [mockCar, mockOppCar]);
assert(typeof oppIntent.intent.confidenceScore === 'number', `Opponent intent confidence score: ${oppIntent.intent.confidenceScore}%`);
assert(['HIGH', 'MEDIUM', 'LOW'].includes(oppIntent.intent.confidenceLevel), `Opponent intent confidence level: ${oppIntent.intent.confidenceLevel}`);
assert(typeof oppIntent.intent.confidenceReason === 'string', `Opponent intent evidence explanation present: "${oppIntent.intent.confidenceReason}"`);

// ── TEST 12: Integration with Information Value Engine ──
console.log('\nTEST 12: Integration with Information Value Engine');
const lowDataCar = { compound: 'HARD', tyreAge: 2, thermalState: { tyreTemp: 98, optimalTemp: 100 } };
const highDataCar = { compound: 'HARD', tyreAge: 18, thermalState: { tyreTemp: 100, optimalTemp: 100 } };
const ivLow = evaluateInformationValue(lowDataCar, 15, 61);
const ivHigh = evaluateInformationValue(highDataCar, 30, 61);

assert(ivLow.confidenceScore < 60, `Low data car has LOW confidence (${ivLow.confidenceScore}%)`);
assert(ivLow.lapsToExtend > 0, `Low data car recommends stint extension for telemetry: ${ivLow.recommendation}`);
assert(ivHigh.confidenceScore >= 75, `High data car has solid confidence (${ivHigh.confidenceScore}%)`);
assert(ivHigh.lapsToExtend === 0, `High data car does not extend solely for telemetry: ${ivHigh.recommendation}`);

// ── TEST 13: Safety Overrides NEVER Overridden by Confidence ──
console.log('\nTEST 13: Safety Overrides NEVER Overridden by Low Confidence');
const blisteredCar = {
  compound: 'SOFT',
  tyreAge: 2, // early stint (low data)
  thermalState: { tyreTemp: 135, optimalTemp: 95, blister: 110 } // severely blistering!
};
const ivSafety = evaluateInformationValue(blisteredCar, 2, 61);
assert(ivSafety.isSafetyCritical === true, 'Safety critical status triggered for blistering');
assert(ivSafety.lapsToExtend === 0, 'No data extension permitted under thermal critical state');
assert(ivSafety.recommendation.includes('BOX'), `Authoritative safety command given: ${ivSafety.recommendation}`);

console.log('\n====================================================');
console.log(`🏁 TEST RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('====================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  console.log('🎉 ALL PREDICTION CONFIDENCE TESTS PASSED PERFECTLY!');
}
