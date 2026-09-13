import { simulate_stint_time, optimal_stop_lap, initStrategy } from './src/simulation/strategy.js';

// Mock model data
const mockModelData = {
    compounds: {
        MEDIUM: { deg_linear: 0.07, deg_quadratic: 0.0015, fresh_pace: 91.0, cliff_lap: 25, cliff_detected: true },
        HARD: { deg_linear: 0.04, deg_quadratic: 0.0005, fresh_pace: 92.0, cliff_lap: 45, cliff_detected: true }
    },
    track_evolution: { slope_s_per_lap: -0.05 },
    fuel: { max_fuel_kg: 110, burn_rate_kg_per_lap: 1.77 },
    race_info: { laps: 62 }
};

initStrategy(mockModelData);

function runScenario(name, overrides = {}) {
    const defaultState = {
        currentCompound: 'MEDIUM',
        currentTyreAge: 15,
        currentRaceLap: 15,
        freshCompound: 'HARD',
        currentFuelKg: 110 - (15 * 1.77),
        setup: { downforceLevel: 'BALANCED', balance: 'BALANCED', mechanicalBalance: 'BALANCED', brakeBias: 'BALANCED', energy: { deploymentStrategy: 'BALANCED' } },
        allCars: []
    };

    const state = { ...defaultState, ...overrides };
    
    // Inject custom mock data overrides if provided
    if (overrides.mockModelData) {
        initStrategy(overrides.mockModelData);
    }

    const result = optimal_stop_lap(
        state.currentCompound, state.currentTyreAge, state.currentRaceLap, 
        state.freshCompound, state.currentFuelKg, state.setup, state.allCars
    );
    
    console.log(`\n--- ${name} ---`);
    console.log(`Optimal Lap: ${result.optimalLap}`);
    console.log(`Min Total Time: ${result.minTotalTime.toFixed(3)}s`);
    
    // Reset mock data
    initStrategy(mockModelData);
    return result;
}

// Scenario A: Normal
const resultA = runScenario("Scenario A: Clear track + normal degradation");

// Scenario B: Traffic exactly at the optimal pit exit
// Assuming optimal lap from A is X.
let carsB = [];
if (resultA.optimalLap !== -1) {
    // Generate a car perfectly placed to interfere with pit exit
    // If pitCost is ~24s, and pace is ~91s. 24/91 = 0.26 progress behind.
    // If we pit, we exit at 0.03. So we want a car that will be at 0.03 when we exit.
    // Progress now = 0.03 - 0.26 = -0.23 -> 0.77
    carsB.push({ isUser: false, progress: 0.77, baseLapTime: 91, compound: 'HARD', tyreAge: 5, setup: defaultSetup() });
}
const resultB = runScenario("Scenario B: Traffic at predicted pit exit", { allCars: carsB });

// Scenario C: High Degradation
const highDegModel = JSON.parse(JSON.stringify(mockModelData));
highDegModel.compounds.MEDIUM.deg_linear = 0.15;
highDegModel.compounds.MEDIUM.deg_quadratic = 0.003;
runScenario("Scenario C: High Degradation", { mockModelData: highDegModel });

// Scenario D: Low Degradation
const lowDegModel = JSON.parse(JSON.stringify(mockModelData));
lowDegModel.compounds.MEDIUM.deg_linear = 0.02;
lowDegModel.compounds.MEDIUM.deg_quadratic = 0.0001;
runScenario("Scenario D: Low Degradation", { mockModelData: lowDegModel });

// Scenario E: Fuel Load change
runScenario("Scenario E: Lower Fuel Load", { currentFuelKg: 40 });

function defaultSetup() {
    return { downforceLevel: 'BALANCED', balance: 'BALANCED', mechanicalBalance: 'BALANCED', brakeBias: 'BALANCED', energy: { deploymentStrategy: 'BALANCED' } };
}
