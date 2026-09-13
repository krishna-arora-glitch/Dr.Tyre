/**
 * test_race_intelligence_feed.js
 * Comprehensive headless test for the Race Intelligence Feed & Alert Priority Engine.
 */

import assert from 'assert';
import {
  AlertCategory,
  AlertStatus,
  RadioCallType,
  categorizeAlert,
  calculatePriorityScore,
  fuseRelatedAlerts,
  deduplicateAndUpdateLifecycle,
  rankAlerts,
  selectTopAlerts
} from './src/simulation/alertPriorityEngine.js';

import {
  evaluateRaceIntelligence,
  resetIntelligenceFeed
} from './src/simulation/raceIntelligenceFeed.js';

console.log('🏁 Starting Race Intelligence Feed Verification Test Suite...\n');

let passedTests = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// ── 1. Priority Scoring & Category ──
test('Priority Scoring Formula', () => {
  const score = calculatePriorityScore({
    severity: 100,
    urgency: 100,
    raceImpact: 100,
    confidence: 100,
    actionability: 100
  });
  assert.strictEqual(score, 100, 'All-100 inputs must produce 100 score');

  // Weights: 0.30 severity, 0.25 urgency, 0.20 raceImpact, 0.10 confidence, 0.15 actionability
  const weightedScore = calculatePriorityScore({
    severity: 80,       // 0.30 * 80 = 24
    urgency: 70,        // 0.25 * 70 = 17.5
    raceImpact: 80,     // 0.20 * 80 = 16
    confidence: 90,     // 0.10 * 90 = 9
    actionability: 60   // 0.15 * 60 = 9
  });
  // Total: 24 + 17.5 + 16 + 9 + 9 = 75.5 -> round = 76
  assert.strictEqual(weightedScore, 76, 'Weighted score must match PRIORITY_WEIGHTS formula');
});

test('Alert Categorization', () => {
  assert.strictEqual(categorizeAlert('TYRE_DEGRADATION', 85), AlertCategory.CRITICAL);
  assert.strictEqual(categorizeAlert('TYRE_DEGRADATION', 60), AlertCategory.WARNING);
  assert.strictEqual(categorizeAlert('UNDERCUT_OPPORTUNITY', 55), AlertCategory.OPPORTUNITY);
  assert.strictEqual(categorizeAlert('TYRE_DEGRADATION', 15), AlertCategory.INFORMATION);
});

// ── 2. Deduplication & Lifecycle ──
test('Alert Lifecycle Progression', () => {
  const existingAlerts = [
    {
      id: 'cliff_MEDIUM',
      type: 'TYRE_CLIFF',
      status: AlertStatus.ACTIVE,
      severity: 80,
      priorityScore: 78
    },
    {
      id: 'thermal_rear',
      type: 'THERMAL_RISK',
      status: AlertStatus.ACTIVE,
      severity: 70,
      timestamp: 10,
      priorityScore: 65
    }
  ];

  const incomingEvents = [
    {
      id: 'cliff_MEDIUM',
      type: 'TYRE_CLIFF',
      severity: 50, // 50 < 80 * 0.7 -> should transition to IMPROVING
      priorityScore: 52
    }
    // thermal_rear not present -> should transition to RESOLVED
  ];

  const updated = deduplicateAndUpdateLifecycle(incomingEvents, existingAlerts, 11);
  
  const cliff = updated.find(a => a.id === 'cliff_MEDIUM');
  assert.ok(cliff, 'cliff alert must persist');
  assert.strictEqual(cliff.status, AlertStatus.IMPROVING, 'Cliff with decreasing severity should be IMPROVING');

  const thermal = updated.find(a => a.id === 'thermal_rear');
  assert.ok(thermal, 'unseen alert must be tracked');
  assert.strictEqual(thermal.status, AlertStatus.RESOLVED, 'Unseen alert should transition to RESOLVED');
});

// ── 3. Alert Fusion ──
test('Alert Fusion: Thermal + Degradation Fusion', () => {
  const events = [
    {
      id: 'deg_rate',
      type: 'TYRE_DEGRADATION',
      priorityScore: 75,
      confidence: 82,
      whyNow: 'Degradation rate exceeded 0.12 s/lap',
      impactIfUnchanged: 'Losing 0.35s/lap',
      recommendation: 'Switch compound at Lap 24',
      relatedFactors: [{ factor: 'Wear', contribution: 70 }, { factor: 'Heat', contribution: 30 }]
    },
    {
      id: 'thermal_overheat',
      type: 'THERMAL_RISK',
      priorityScore: 72,
      confidence: 85,
      whyNow: 'Surface temperature 128C',
      impactIfUnchanged: 'Blistering risk critical',
      recommendation: 'Increase lift and coast',
      relatedFactors: [{ factor: 'Tarmac Temp', contribution: 60 }, { factor: 'Sliding', contribution: 40 }]
    }
  ];

  const fused = fuseRelatedAlerts(events);
  assert.strictEqual(fused.length, 1, 'Thermal and Deg alerts should fuse into 1 compound alert');
  assert.ok(fused[0].fusedFrom && fused[0].fusedFrom.length >= 2, 'Fused alert should record fused member types');
  assert.ok(fused[0].relatedFactors.length >= 2, 'Fused alert should aggregate related factors');
});

// ── 4. 10-Detector Intelligence Feed Execution ──
test('evaluateRaceIntelligence on Realistic Lap State', () => {
  resetIntelligenceFeed();

  const mockUserCar = {
    id: 11,
    number: '11',
    compound: 'MEDIUM',
    tyreAge: 22,
    fuelPct: 0.55,
    setup: { downforce: 0.5 },
    pitStops: 0,
    thermalState: {
      temperature: 122,
      thermalState: 'BLISTERING',
      thermalPenalty: 0.45
    },
    dynamicDegradation: {
      currentRate: 0.135,
      rateFormatted: '0.135 s/L',
      trend: 'ACCELERATING',
      acceleration: 0.02
    },
    driverBehaviour: {
      style: 'AGGRESSIVE',
      smoothness: 42,
      consistency: 55,
      tyreStressFactor: 1.25,
      effectSummary: 'Aggressive inputs accelerating rear degradation'
    }
  };

  const mockCars = [
    { id: 1, number: '1', raceTime: 920.0, compound: 'MEDIUM', tyreAge: 18, isUser: false },
    { id: 11, number: '11', raceTime: 921.8, compound: 'MEDIUM', tyreAge: 22, isUser: true },
    { id: 44, number: '44', raceTime: 923.0, compound: 'HARD', tyreAge: 12, isUser: false }
  ];

  const mockModelData = {
    compounds: {
      SOFT: { base_pace: 93.0, deg_linear: 0.12, cliff_lap: 18 },
      MEDIUM: { base_pace: 94.0, deg_linear: 0.07, cliff_lap: 30 },
      HARD: { base_pace: 95.0, deg_linear: 0.04, cliff_lap: 48 }
    }
  };

  const result = evaluateRaceIntelligence(
    mockUserCar,
    mockCars,
    22,   // currentLap
    61,   // totalLaps
    mockModelData,
    'GREEN'
  );

  assert.ok(result, 'Result should exist');
  assert.ok(Array.isArray(result.alerts), 'Alerts must be array');
  assert.ok(Array.isArray(result.topAlerts), 'topAlerts must be array');
  assert.ok(result.topAlerts.length <= 5, 'Top alerts capped at 5');
  assert.ok(result.topAlerts.length > 0, 'Active critical state must generate alerts');

  const top = result.topAlerts[0];
  assert.ok(top.whyNow && top.whyNow.length > 0, 'Must have WHY NOW');
  assert.ok(top.impactIfUnchanged && top.impactIfUnchanged.length > 0, 'Must have IMPACT');
  assert.ok(top.recommendation && top.recommendation.length > 0, 'Must have PRESCRIPTION');
  assert.ok(top.confidence >= 50 && top.confidence <= 100, 'Confidence must be within 50-100');
  assert.ok(!isNaN(top.priorityScore), 'Priority score must be a valid number');

  console.log(`    Detected ${result.activeCount} active alerts (${result.opportunityCount} opportunities).`);
  console.log(`    Top Alert: [${top.category}] ${top.title} (Score: ${top.priorityScore.toFixed(1)}, Conf: ${top.confidence}%)`);
  if (top.proposedRadio) {
    console.log(`    Proposed Radio: "${top.proposedRadio.message}"`);
  }
});

// ── 5. Learning Log Record Creation ──
test('Learning Log Generation on Lap Progression', () => {
  resetIntelligenceFeed();

  const mockUserCar = {
    id: 11,
    number: '11',
    compound: 'MEDIUM',
    tyreAge: 25,
    thermalState: { temperature: 120, thermalState: 'BLISTERING', thermalPenalty: 0.4 },
    dynamicDegradation: { currentRate: 0.14, rateFormatted: '0.140 s/L', trend: 'ACCELERATING', acceleration: 0.02 },
    driverBehaviour: { tyreStressFactor: 1.2 }
  };

  const mockCars = [{ id: 11, raceTime: 1000, compound: 'MEDIUM', isUser: true }];
  const mockModelData = {
    compounds: {
      MEDIUM: { base_pace: 94.0, deg_linear: 0.07, cliff_lap: 30 }
    }
  };

  // Lap 25
  const res1 = evaluateRaceIntelligence(mockUserCar, mockCars, 25, 61, mockModelData, 'GREEN');
  // Advance to Lap 27 (2 laps after alert created on lap 25)
  mockUserCar.tyreAge = 27;
  const res2 = evaluateRaceIntelligence(mockUserCar, mockCars, 27, 61, mockModelData, 'GREEN');

  assert.ok(Array.isArray(res2.learningLog), 'Learning log should be an array');
  assert.ok(res2.learningLog.length > 0, 'Learning log should contain evaluation records across laps');
  const logEntry = res2.learningLog[0];
  assert.ok(logEntry.metric, 'Log entry must specify metric');
  assert.ok(logEntry.predicted !== undefined, 'Log entry must specify predicted');
  console.log(`    Learning log created ${res2.learningLog.length} prediction validation records.`);
});

console.log(`\n🎉 All ${passedTests} test assertions passed successfully!`);
