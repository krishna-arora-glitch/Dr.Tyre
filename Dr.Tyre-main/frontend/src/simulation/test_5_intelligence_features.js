/**
 * test_5_intelligence_features.js
 * 
 * Comprehensive unit test suite for the 5 advanced tyre intelligence features:
 * 1. INDIVIDUAL TYRE DEGRADATION MATRIX (FL, FR, RL, RR)
 * 2. DYNAMIC DEGRADATION RATE + ACCELERATION
 * 3. TRACK DEGRADATION MAP
 * 4. TYRE RECOVERY INTELLIGENCE
 * 5. RACE EVENT OPPORTUNITY DETECTOR
 */

import { computeIndividualTyres } from './individualTyres.js';
import { updateDynamicDegradation, DEG_TRENDS } from './dynamicDegradation.js';
import { computeTrackDegradationMap, getActiveTrackSegment } from './trackDegradationMap.js';
import { evaluateTyreRecovery } from './tyreRecovery.js';
import { detectRaceOpportunities } from './opportunityDetector.js';
import { initStrategy, getPrescription, getMarginalDegRate } from './strategy.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  PASS: ${message}`);
    passed++;
  } else {
    console.error(`  FAIL: ${message}`);
    failed++;
  }
}

// ── Mock Pipeline Model Data ──
const mockModelData = {
  compounds: {
    SOFT: { trusted: true, deg_linear: 0.08, deg_quadratic: 0.003, stress_coef: 0.025, fresh_pace: 90.0 },
    MEDIUM: { trusted: true, deg_linear: 0.05, deg_quadratic: 0.002, stress_coef: 0.020, fresh_pace: 91.5 },
    HARD: { trusted: true, deg_linear: 0.03, deg_quadratic: 0.001, stress_coef: 0.015, fresh_pace: 93.0 }
  },
  track_evolution: { slope_s_per_sec: -0.0001 }
};

initStrategy(mockModelData);

console.log('\n==================================================');
console.log('TEST SUITE: 5 ADVANCED TYRE INTELLIGENCE FEATURES');
console.log('==================================================\n');

// ── TEST 1: INDIVIDUAL TYRE DEGRADATION MATRIX ──
console.log('--- TEST 1: Individual Tyre Degradation Matrix (FL, FR, RL, RR) ---');
const car1 = {
  compound: 'MEDIUM',
  tyreAge: 15,
  setup: { brakeBias: 'FRONT', balance: 'FRONT' },
  speed: 195,
  brake: 3.5,
  throttle: 95,
  progress: 0.15, // Turn 1-3 right-hander zone loading left tyres
  tyreTemp: 104,
  thermalState: { tyreTemp: 104, optimalTemp: 100, deltaT: 4.0 },
  tyreHealth: { marginalDegRate: 0.075, gripLevel: 78, tyreEnergyLaps: 16 }
};

const tyres1 = computeIndividualTyres(car1, mockModelData);

assert(tyres1.FL && tyres1.FR && tyres1.RL && tyres1.RR, 'Matrix contains all 4 corners (FL, FR, RL, RR)');
assert(typeof tyres1.FL.degradationRate === 'number' && tyres1.FL.degradationRate > 0, 'FL has positive degradationRate');
assert(typeof tyres1.FR.temperature === 'number', 'FR has temperature');
assert(['OPT', 'WARM', 'HOT', 'BLISTER', 'COLD'].includes(tyres1.FL.thermalState), 'FL has valid thermalState');
assert(tyres1.limitingTyre === 'FL' || tyres1.limitingTyre === 'FR' || tyres1.limitingTyre === 'RL' || tyres1.limitingTyre === 'RR', 'Identifies limiting/worst tyre');

// Authoritative internal consistency: 4-corner average equals car authoritative rate
const cornerAvgRate = (tyres1.FL.degradationRate + tyres1.FR.degradationRate + tyres1.RL.degradationRate + tyres1.RR.degradationRate) / 4.0;
assert(Math.abs(cornerAvgRate - car1.tyreHealth.marginalDegRate) < 0.003, `4-corner average (${cornerAvgRate.toFixed(3)}) strictly matches authoritative rate (${car1.tyreHealth.marginalDegRate})`);
assert(tyres1.worstRatio >= 1.0, `Worst tyre ratio is >= 1.0 (actual: ${tyres1.worstRatio}x)`);
assert(typeof tyres1.imbalanceMessage === 'string' && tyres1.imbalanceMessage.length > 0, `Generates imbalance message: "${tyres1.imbalanceMessage}"`);

// ── TEST 2: DYNAMIC DEGRADATION RATE + ACCELERATION ──
console.log('\n--- TEST 2: Dynamic Degradation Rate + Acceleration ---');
const car2 = {
  compound: 'SOFT',
  tyreAge: 10,
  setup: null,
  speed: 180,
  thermalState: { tyreTemp: 98, optimalTemp: 95, deltaT: 3.0, thermalPenalty: 0.05 }
};

// Initial update
const dyn1 = updateDynamicDegradation(car2, 0.05);
assert(typeof dyn1.currentRate === 'number' && dyn1.currentRate > 0, `Computes dynamic degradation rate: ${dyn1.rateFormatted}`);
assert(typeof dyn1.acceleration === 'number', `Computes degradation acceleration: ${dyn1.accelFormatted}`);
assert([DEG_TRENDS.STABLE, DEG_TRENDS.IMPROVING, DEG_TRENDS.DEGRADING, DEG_TRENDS.ACCELERATING, DEG_TRENDS.SEVERE].includes(dyn1.trend), `Classifies trend: ${dyn1.trend}`);

// Simulate overheating and acceleration spike
car2.tyreAge = 14;
car2.thermalState = { tyreTemp: 112, optimalTemp: 95, deltaT: 17.0, thermalPenalty: 0.85 };
const dynOverheat = updateDynamicDegradation(car2, 0.05);
assert(dynOverheat.currentRate > dyn1.currentRate, `Thermal penalty increases dynamic rate (${dynOverheat.rateFormatted} > ${dyn1.rateFormatted})`);
assert(dynOverheat.isAccelerating, 'Detects acceleration under severe thermal penalty');

// Simulate cooling down / tyre management
car2.tyreAge = 16;
car2.thermalState = { tyreTemp: 95, optimalTemp: 95, deltaT: 0.0, thermalPenalty: 0.0 };
// Commit to history
car2.dynamicDegradationState.previousLapRates.push({ lapAge: 14, rate: dynOverheat.currentRate });
car2.dynamicDegradationState.smoothedRate = 0.070;
const dynCooled = updateDynamicDegradation(car2, 0.05);
assert(dynCooled.currentRate < dynOverheat.currentRate, `Cooled tyre reduces degradation rate (${dynCooled.rateFormatted} < ${dynOverheat.rateFormatted})`);
assert(typeof dynCooled.historyTrace === 'string' && dynCooled.historyTrace.includes('→'), `Produces valid history trace: ${dynCooled.historyTrace}`);

// ── TEST 3: TRACK DEGRADATION MAP ──
console.log('\n--- TEST 3: Track Degradation Map ---');
const trackMapSing = computeTrackDegradationMap('singapore', car1, mockModelData);
assert(Array.isArray(trackMapSing) && trackMapSing.length >= 10, `Generated ${trackMapSing.length} Singapore circuit segments`);

const firstSeg = trackMapSing[0];
assert(firstSeg.intensity >= 0 && firstSeg.intensity <= 100, `Segment intensity is bounded [0, 100] (actual: ${firstSeg.intensity})`);
const sumContrib = firstSeg.contributors.cornering + firstSeg.contributors.thermal + firstSeg.contributors.braking + firstSeg.contributors.traction;
assert(sumContrib === 100, `Contributor percentages sum exactly to 100% (sum: ${sumContrib})`);

const activeSeg = getActiveTrackSegment(trackMapSing, 0.35);
assert(activeSeg && activeSeg.sector === 2, `Position 0.35 correctly resolves to Sector 2 segment: ${activeSeg?.name}`);

// Test Monza and Monaco mappings
const trackMapMonza = computeTrackDegradationMap('monza', car1, mockModelData);
assert(trackMapMonza.length >= 6, `Generated ${trackMapMonza.length} Monza circuit segments`);

// ── TEST 4: TYRE RECOVERY INTELLIGENCE ──
console.log('\n--- TEST 4: Tyre Recovery Intelligence ---');
const overheatedCar = {
  compound: 'MEDIUM',
  tyreAge: 12,
  speed: 180,
  thermalState: { tyreTemp: 111, optimalTemp: 100, deltaT: 11.0, thermalPenalty: 0.45 },
  dynamicDegradation: { currentRate: 0.095 }
};

const recoveryOverheated = evaluateTyreRecovery(overheatedCar, mockModelData, 2);
assert(recoveryOverheated.recoverablePerformance > 0, `Overheated tyre has recoverable performance: ${recoveryOverheated.recoverableFormatted}`);
assert(recoveryOverheated.recoveryPotentialPct > 40, `Recovery potential is significant (${recoveryOverheated.recoveryPotentialPct}%)`);
assert(recoveryOverheated.isRecoverable === true, 'Flags management as physically feasible');
assert(recoveryOverheated.explanation.toLowerCase().includes('recoverable') || recoveryOverheated.explanation.toLowerCase().includes('elevated'), 'Diagnostic explanation correctly identifies recoverable thermal load');

// Test worn tyre with low thermal load (irreversible wear dominant)
const wornCar = {
  compound: 'MEDIUM',
  tyreAge: 28,
  speed: 180,
  thermalState: { tyreTemp: 100, optimalTemp: 100, deltaT: 0.0, thermalPenalty: 0.0 },
  dynamicDegradation: { currentRate: 0.110 }
};
const recoveryWorn = evaluateTyreRecovery(wornCar, mockModelData, 2);
assert(recoveryWorn.recoveryPotentialPct < 30, `Worn tyre correctly has low recovery potential (${recoveryWorn.recoveryPotentialPct}%)`);
assert(recoveryWorn.explanation.toLowerCase().includes('irreversible') || recoveryWorn.explanation.toLowerCase().includes('wear'), 'Correctly identifies wear as irreversible');

// ── TEST 5: RACE EVENT OPPORTUNITY DETECTOR ──
console.log('\n--- TEST 5: Race Event Opportunity Detector ---');
const mockCars = [
  { id: 'rival1', number: 4, position: 1, tyreAge: 24, dynamicDegradation: { currentRate: 0.105, isSevere: true }, thermalState: { tyreTemp: 110 } },
  { id: 'userCar', number: 11, position: 2, tyreAge: 12, gapToAheadTime: 1.6, dynamicDegradation: { currentRate: 0.065 }, thermalState: { tyreTemp: 102 } },
  { id: 'rival2', number: 16, position: 3, tyreAge: 14, gapToAheadTime: 3.2, dynamicDegradation: { currentRate: 0.070 }, thermalState: { tyreTemp: 101 } }
];

const oppUser = mockCars[1];
const oppReport = detectRaceOpportunities(oppUser, mockCars, 20, 61, 'GREEN', mockModelData);

assert(Array.isArray(oppReport.opportunities) && oppReport.opportunities.length > 0, `Detected ${oppReport.opportunities.length} tactical opportunities`);

const undercutOpp = oppReport.opportunities.find(o => o.type === 'UNDERCUT');
assert(undercutOpp !== undefined, 'Successfully detected UNDERCUT OPPORTUNITY');
if (undercutOpp) {
  assert(undercutOpp.score >= 50 && undercutOpp.score <= 100, `Undercut score is properly bounded [0, 100]: ${undercutOpp.score}%`);
  assert(undercutOpp.confidence === 'HIGH' || undercutOpp.confidence === 'MEDIUM', `Undercut confidence is defined: ${undercutOpp.confidence}`);
  assert(typeof undercutOpp.benefit === 'string' && undercutOpp.benefit.length > 0, `Expected benefit provided: "${undercutOpp.benefit}"`);
}

const rivalDegOpp = oppReport.opportunities.find(o => o.type === 'COMPETITOR_DEGRADATION');
assert(rivalDegOpp !== undefined, 'Successfully detected RIVAL DEGRADATION OPPORTUNITY');

// Test Safety Car Opportunity
const scReport = detectRaceOpportunities(oppUser, mockCars, 20, 61, 'SC', mockModelData);
const scOpp = scReport.opportunities.find(o => o.type === 'SAFETY_CAR');
assert(scOpp !== undefined && scOpp.score >= 90, 'Successfully detected SAFETY CAR CHEAP PIT OPPORTUNITY under SC');

// ── TEST 6: STRATEGY & PRESCRIPTION INTEGRATION ──
console.log('\n--- TEST 6: Strategy & Prescription Integration ---');
const rxResult = getPrescription('MEDIUM', 16, 20, 60, null, mockCars, { tyreTemp: 106, optimalTemp: 100 }, 0, null, recoveryOverheated, oppReport);

assert(rxResult && rxResult.action, `Prescription action produced: "${rxResult.action}"`);
assert(rxResult.tyreRecovery !== undefined, 'Prescription result contains tyreRecovery payload');
assert(rxResult.opportunityReport !== undefined, 'Prescription result contains opportunityReport payload');
assert(typeof rxResult.recommendedAction === 'string', `Prescription recommendedAction: "${rxResult.recommendedAction}"`);

console.log('\n==================================================');
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('==================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('ALL 5 TYRE INTELLIGENCE FEATURES VERIFIED PERFECTLY!\n');
}
