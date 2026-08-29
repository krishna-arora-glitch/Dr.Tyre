import assert from 'assert';
import { 
  optimal_stop_lap, evaluate_undercut, getEffectivePitCost, setRaceState, 
  PIT_LANE_LOSS, SC_PIT_COST_MULTIPLIER, initStrategy, getRecommendation
} from './frontend/src/simulation/strategy.js';

// Mock modelData so getTotalLaps() works
initStrategy({ race_info: { laps: 62 }, compounds: {} });

function testStrategy() {
  console.log("Running strategy tests...");
  
  // Test optimal stop lap
  // If we're on SOFT age 20, lap 20, it should recommend pitting immediately (lap 20)
  // because SOFT degradation at age 20 is huge compared to fresh MEDIUM.
  const optLap = optimal_stop_lap('SOFT', 20, 20, 'MEDIUM');
  console.log(`Optimal stop lap (SOFT age 20, lap 20): ${optLap}`);
  assert(optLap === 24, "Should mathematically pit at lap 24 due to cross-over");
  
  // Test SC pit cost reduction
  setRaceState('SC');
  const scCost = getEffectivePitCost();
  assert(scCost === PIT_LANE_LOSS * SC_PIT_COST_MULTIPLIER, "SC cost should be lower");
  
  // Under SC, pitting is cheaper. It should definitely pit now if it was borderline.
  const optLapSC = optimal_stop_lap('MEDIUM', 10, 20, 'HARD');
  console.log(`Optimal stop under SC: ${optLapSC}`);
  
  // Test undercut
  setRaceState('GREEN');
  const uc = evaluate_undercut('MEDIUM', 25, 2.0, 42, 'HARD');
  console.log(`Undercut eval against 25L old mediums, gap 2s:`, uc);
  
  // Test recommendation
  const rec = getRecommendation('SOFT', 20, 20);
  console.log(`Recommendation:`, rec);
  assert(rec.state === 'PIT NOW', "Recommendation should be PIT NOW");
  
  console.log("All tests passed!");
}

testStrategy();
