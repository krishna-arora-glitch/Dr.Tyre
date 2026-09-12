/**
 * test_4_strategic_features.js
 * 
 * Comprehensive Unit Test Suite for the 4 Strategic Intelligence Features:
 *   1. Battle-Aware Tyre Management (battleManagement.js)
 *   2. Tyre Fingerprint Engine (tyreFingerprint.js)
 *   3. Opponent Intent Prediction & Tactical Response (opponentIntent.js)
 *   4. Information Value Engine (informationValue.js)
 */

import assert from 'assert';
import { evaluateBattleManagement } from './battleManagement.js';
import { computeTyreFingerprint, archiveStintFingerprint } from './tyreFingerprint.js';
import { evaluateOpponentIntent } from './opponentIntent.js';
import { evaluateInformationValue } from './informationValue.js';
import { initStrategy } from './strategy.js';

console.log('🏁 STARTING 4 STRATEGIC INTELLIGENCE FEATURES TEST SUITE...');

// Initialize mock model data for strategy & ML degradation models
const mockModelData = {
  compounds: {
    SOFT: { deg_linear: 0.11, deg_quadratic: 0.0015, deg_linear_ci: [0.09, 0.13], cliff_lap: 18, stress_coef: 0.03 },
    MEDIUM: { deg_linear: 0.065, deg_quadratic: 0.0009, deg_linear_ci: [0.05, 0.08], cliff_lap: 30, stress_coef: 0.02 },
    HARD: { deg_linear: 0.038, deg_quadratic: 0.0004, deg_linear_ci: [0.025, 0.05], cliff_lap: 48, stress_coef: 0.015 }
  }
};
initStrategy(mockModelData);

// ─────────────────────────────────────────────────────────────
// TEST 1: BATTLE-AWARE TYRE MANAGEMENT
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST 1: Feature 1 - Battle-Aware Tyre Management ---');

const userCar = {
  compound: 'MEDIUM',
  tyreAge: 14,
  setup: { downforceLevel: 'MEDIUM', balance: 'NEUTRAL' },
  thermalState: { tyreTemp: 101, optimalTemp: 100, blisterTemp: 125, thermalPenalty: 0.05 },
  driverBehaviour: { aggressionIndex: 75, tyreStressModifier: 1.05 }
};

const rivalAhead = {
  number: 16,
  compound: 'MEDIUM',
  tyreAge: 18,
  gapToAhead: 0.85, // Inside DRS window!
  setup: null
};

const rivalBehind = {
  number: 4,
  gapToBehind: 3.2
};

const battleAtk = evaluateBattleManagement(userCar, rivalAhead, rivalBehind, 15, 61, mockModelData);
console.log('Battle Result (Attacking in DRS):', battleAtk.decision);
console.log('Attack Expected Value:', battleAtk.attack.expectedValue, 'vs Manage Value:', battleAtk.manage.expectedValue);
console.log('Overtake Prob:', battleAtk.attack.overtakeProbability + '%');

assert(battleAtk.attack.lapGain > 0.3, `Attack lap gain (+${battleAtk.attack.lapGain}s) should be substantial`);
assert(battleAtk.attack.tyreCost > 0.02, `Attack tyre cost (+${battleAtk.attack.tyreCost}s/L) should be non-zero`);
assert(battleAtk.attack.overtakeProbability >= 45, `Overtake probability (${battleAtk.attack.overtakeProbability}%) should reflect close DRS proximity`);
assert(battleAtk.decision.includes('ATTACK IS WORTH THE TYRE COST'), `Decision should recommend attack when DRS and expected value are high`);

// Safety Override Test: Overheating / Blistering Tyre
const overheatedCar = {
  ...userCar,
  thermalState: { tyreTemp: 130, optimalTemp: 100, blisterTemp: 125, thermalPenalty: 0.65 }
};
const battleSafety = evaluateBattleManagement(overheatedCar, rivalAhead, rivalBehind, 15, 61, mockModelData);
console.log('Battle Result (Overheating):', battleSafety.decision);
assert(battleSafety.decision.includes('BLISTERING HAZARD'), `Blistering tyre must force safety override`);
assert.strictEqual(battleSafety.isWorthCost, false, `Overheating tyre cannot be worth the attack cost`);
console.log('✅ Feature 1: Battle-Aware Tyre Management PASSED.');

// ─────────────────────────────────────────────────────────────
// TEST 2: TYRE FINGERPRINT ENGINE
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST 2: Feature 2 - Tyre Fingerprint Engine ---');

const fpCar = {
  compound: 'MEDIUM',
  tyreAge: 16,
  setup: { downforceLevel: 'HIGH', balance: 'NEUTRAL' },
  thermalState: { tyreTemp: 102, optimalTemp: 100, thermalPenalty: 0.04 },
  lapStress: { corneringG: 3.2, stressScore: 68 },
  driverBehaviour: { smoothnessScore: 72, tyreStressModifier: 1.02 }
};

const fpResult = computeTyreFingerprint(fpCar, mockModelData);
console.log('Tyre Fingerprint 7-Vectors:', fpResult.fingerprint);

const fp = fpResult.fingerprint;
assert(fp.warmup >= 0 && fp.warmup <= 100, 'Warm-up within [0, 100]');
assert(fp.peakGrip >= 0 && fp.peakGrip <= 100, 'Peak Grip within [0, 100]');
assert(fp.thermalStress >= 0 && fp.thermalStress <= 100, 'Thermal Stress within [0, 100]');
assert(fp.mechanicalWear >= 0 && fp.mechanicalWear <= 100, 'Mechanical Wear within [0, 100]');
assert(fp.sliding >= 0 && fp.sliding <= 100, 'Sliding within [0, 100]');
assert(fp.degradation >= 0 && fp.degradation <= 100, 'Degradation within [0, 100]');
assert(fp.recovery >= 0 && fp.recovery <= 100, 'Recovery within [0, 100]');

// Test Stint Archiving & Comparison
archiveStintFingerprint(fpCar, fpResult);
assert(fpCar.stintFingerprints.length === 1, 'Stint 1 archived');

// Simulate Stint 2 on HARD tyre with higher sliding
const stint2Car = {
  ...fpCar,
  compound: 'HARD',
  tyreAge: 10,
  thermalState: { tyreTemp: 112, optimalTemp: 100, thermalPenalty: 0.25 },
  driverBehaviour: { smoothnessScore: 40, tyreStressModifier: 1.15 } // much rougher
};
const stint2Result = computeTyreFingerprint(stint2Car, mockModelData);
console.log('Stint 2 Comparison against Stint 1:', stint2Result.comparison);
assert(stint2Result.comparison !== null, 'Stint 2 comparison should be generated');
assert(stint2Result.comparison.notes.length > 0, 'Comparison notes should highlight thermal or sliding variances');
console.log('✅ Feature 2: Tyre Fingerprint Engine PASSED.');

// ─────────────────────────────────────────────────────────────
// TEST 3: OPPONENT INTENT PREDICTION & COMPETITOR DETAIL
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST 3: Feature 3 - Opponent Intent & Competitor Prescription ---');

const competitor16 = {
  number: 16,
  driverName: 'Leclerc',
  position: 8,
  compound: 'MEDIUM',
  tyreAge: 26, // Close to cliff (30) and optimal stop window
  fuelPct: 45,
  setup: null,
  thermalState: { tyreTemp: 105, optimalTemp: 100 },
  pitStops: 0,
  gapToUser: -2.1 // 2.1s ahead of user
};

const userCarState = {
  number: 11,
  position: 9,
  compound: 'MEDIUM',
  tyreAge: 14,
  setup: null,
  optimalPitLap: 29
};

const oppReport = evaluateOpponentIntent(competitor16, userCarState, 26, 61, [competitor16, userCarState], mockModelData);
console.log('Competitor 16 Optimal Pit:', oppReport.prescription.optimalPitLap);
console.log('Intent Probabilities:', `Next 1L: ${oppReport.intent.p1}%, Next 2L: ${oppReport.intent.p2}%, Next 3L: ${oppReport.intent.p3}%`);
console.log('Intent Reasoning:', oppReport.intent.intentReasoning);
console.log('Why Bullets:', oppReport.prescription.whyBullets);
console.log('Our Tactical Response:', oppReport.tacticalResponse.action, '-', oppReport.tacticalResponse.reason);

assert(oppReport.intent.p2 >= 60, `Intent probability within 2 laps (${oppReport.intent.p2}%) should be high near optimal pit window`);
assert(oppReport.prescription.whyBullets.length >= 3, `Prescription should generate at least 3 physical "Why?" bullets`);
assert(['COVER', 'UNDERCUT', 'RESPOND'].includes(oppReport.tacticalResponse.action), `Our response to a rival ahead pitting soon should be active (e.g. UNDERCUT or COVER)`);
console.log('✅ Feature 3: Opponent Intent & Competitor Strategy PASSED.');

// ─────────────────────────────────────────────────────────────
// TEST 4: INFORMATION VALUE ENGINE
// ─────────────────────────────────────────────────────────────
console.log('\n--- TEST 4: Feature 4 - Information Value Engine ---');

// Case A: High uncertainty early stint on new compound
const earlyStintCar = {
  compound: 'HARD',
  tyreAge: 4, // low observed laps
  setup: null,
  thermalState: { tyreTemp: 100, optimalTemp: 100, blisterTemp: 125 }
};
const infoValEarly = evaluateInformationValue(earlyStintCar, 18, 61, mockModelData);
console.log('Early Stint Info Value:', infoValEarly.recommendation);
console.log('Expected Uncertainty Reduction:', infoValEarly.uncertaintyReductionPct + '%', 'Time Cost:', infoValEarly.expectedTimeCost + 's');
assert(infoValEarly.uncertaintyReductionPct > 20, 'Uncertainty reduction should be substantial for new compound');
assert(infoValEarly.recommendation.includes('EXTEND') || infoValEarly.lapsToExtend > 0, 'High uncertainty with ample race distance should recommend extension for data collection');

// Case B: Safety Override near cliff or blistering
const cliffCar = {
  compound: 'MEDIUM',
  tyreAge: 29, // cliff is 30
  setup: null,
  thermalState: { tyreTemp: 102, optimalTemp: 100, blisterTemp: 125 }
};
const infoValCliff = evaluateInformationValue(cliffCar, 29, 61, mockModelData);
console.log('Cliff Car Info Value:', infoValCliff.recommendation);
assert.strictEqual(infoValCliff.isSafetyCritical, true, 'Near cliff condition must trigger safety override');
assert.strictEqual(infoValCliff.lapsToExtend, 0, 'Safety critical tyre must never extend laps for data');
assert(infoValCliff.recommendation.includes('DO NOT EXTEND FOR DATA'), 'Recommendation must prioritize safety/carcass preservation');
console.log('✅ Feature 4: Information Value Engine PASSED.');

console.log('\n🎉 ALL 4 STRATEGIC INTELLIGENCE FEATURES TESTS PASSED SUCCESSFULLY!');
