/**
 * simulation.js — Live Simulation Orchestrator
 * Fully overhauled for the Race Control dashboard.
 */

import { initTrack, syncCarsToSVG, renderCars, getPitLaneConfig, getPitBoxTarget } from './track.js';
import { generateGrid, evaluateAIPit, getAIFreshCompound } from './competitors.js';
import { applyScenario } from './scenarios.js';
import { 
  initStrategy, updateStrategyCompound, getDegradationDelta, getDegradationUncertainty,
  getMarginalDegRate, getRecommendation, getPrescription, getFuelRemaining, getFuelBurnRate,
  getTotalLaps, setRaceState, optimal_stop_lap, evaluate_undercut,
  setWeatherCondition, calculateOptimalRefuelAmount, REFUEL_RATE_KG_PER_SEC, TYRE_CHANGE_TIME_SEC,
  COMPOUND_THERMAL_WINDOWS, calculateThermalPenalty, resetOptimalTracking
} from './strategy.js';
import { drawSparkline } from './sparkline.js'; 
import { CIRCUITS } from './circuits.js';
import { raceSetup, lockSetup, unlockSetup } from '../setup/setup.js';
import { initTelemetryUI, updateTelemetryUI } from './telemetry-ui.js';
import { activePrior } from '../fuel-prior-state.js';
import { buildTrackProfile, evaluateCarPhysics, getProfileAvgSpeed } from './trackDynamics.js';
import { computeTyreHealth } from './tyreHealth.js';
import { updateDriverBehaviour, createDriverBehaviourState } from './driverBehaviour.js';
import { computeIndividualTyres } from './individualTyres.js';
import { updateDynamicDegradation } from './dynamicDegradation.js';
import { computeTrackDegradationMap, getActiveTrackSegment } from './trackDegradationMap.js';
import { evaluateTyreRecovery } from './tyreRecovery.js';
import { detectRaceOpportunities } from './opportunityDetector.js';

let modelData = null;
let telemetryData = null;
let simInterval = null;
let lastTick = 0;

function getBaseLapTime() {
  const circuit = CIRCUITS[raceConfig.trackId];
  return circuit ? circuit.baseLapTimeSec : 94.0;
}

const state = {
  active: false,
  speed: 2,
  lap: 1,
  totalLaps: 61,
  cars: [],
  raceEvent: 'GREEN',
  eventLapsRemaining: 0,
  queuedEvents: [], // { lap: 28, type: 'SC', duration: 3 }
  eventsLog: [],
  lapHistory: {}, // Records positions per lap for lap chart
  pitHistory: [], // Records pit stops: { lap, carId, duration, compound }
  penalties: [], // Records penalties: { lap, carId, type, time }
  weatherHistory: { airTemp: [], trackTemp: [], laps: [] },
  userCar: null,
};

export const raceConfig = {
  trackId: 'singapore',
  condition: 'DRY'
};

const stateListeners = [];

export function setRaceConfig(trackId, condition) {
  raceConfig.trackId = trackId;
  raceConfig.condition = condition;
  
  // Propagate condition to strategy engine
  setWeatherCondition(condition);
}

export function onSimulationUpdate(callback) {
  stateListeners.push(callback);
}

export function getSimulationState() {
  return state;
}
if (typeof window !== 'undefined') {
  window.getSimulationState = getSimulationState;
}

const DOM = {};

export function initSimulation(data, telData) {
  modelData = data;
  telemetryData = telData;
  // Make available globally for quick access in UI components if needed
  window.modelData = data;
  window.telemetryData = telData;
  initStrategy(data);
  
  // Cache DOM
  DOM.startScreen = document.getElementById('start-screen');
  DOM.raceControl = document.getElementById('race-control-layout');
  DOM.finishScreen = document.getElementById('finish-screen');
  DOM.whyModal = document.getElementById('why-modal');
  DOM.btnStartRace = document.getElementById('btn-start-race');
  DOM.btnRestartRace = document.getElementById('btn-restart-race');
  DOM.scenarioSelect = document.getElementById('scenario-select');
  DOM.gridPositionSelect = document.getElementById('grid-position-select');
  DOM.trackSvg = document.getElementById('track-canvas-container'); // Using same property name for compatibility
  
  // Controls
  DOM.btnPlayPause = document.getElementById('ctrl-play-pause');
  DOM.btnRestart = document.getElementById('ctrl-restart');
  DOM.speedBtns = document.querySelectorAll('.spd-btn');
  DOM.btnManualPit = document.getElementById('btn-manual-pit');
  DOM.pitOpts = document.querySelectorAll('.pit-opt');
  DOM.btnWhy = document.getElementById('btn-why');
  DOM.btnCloseWhy = document.getElementById('btn-close-why');
  
  // Telemetry
  DOM.rcLap = document.getElementById('rc-lap');
  DOM.rcPos = document.getElementById('rc-pos');
  DOM.rcTyre = document.getElementById('rc-tyre');
  DOM.rcAge = document.getElementById('rc-age');
  DOM.rcFuelBar = document.getElementById('rc-fuel-bar');
  DOM.rcFuelText = document.getElementById('rc-fuel-text');
  DOM.rcDelta = document.getElementById('rc-delta');
  DOM.rcDegRate = document.getElementById('rc-deg-rate');
  DOM.rcHealthGrip = document.getElementById('rc-health-grip');
  DOM.rcHealthTread = document.getElementById('rc-health-tread');
  DOM.rcHealthDegRate = document.getElementById('rc-health-deg-rate');
  DOM.rcHealthEnergy = document.getElementById('rc-health-energy');
  DOM.rcPunctureBadge = document.getElementById('rc-puncture-badge');
  DOM.rcPanelGripBar = document.getElementById('rc-panel-grip-bar');
  DOM.rcPanelTreadBar = document.getElementById('rc-panel-tread-bar');
  DOM.rcPanelPunctureScore = document.getElementById('rc-panel-puncture-score');
  DOM.rcPanelPunctureLevel = document.getElementById('rc-panel-puncture-level');
  DOM.rcPanelTyreBadge = document.getElementById('rc-panel-tyre-badge');
  DOM.rcPanelTyreTemp = document.getElementById('rc-panel-tyre-temp');
  DOM.rcRiskAge = document.getElementById('rc-risk-age');
  DOM.rcRiskCliff = document.getElementById('rc-risk-cliff');
  DOM.rcRiskThermal = document.getElementById('rc-risk-thermal');
  DOM.rcRiskBlister = document.getElementById('rc-risk-blister');
  DOM.rcRiskStress = document.getElementById('rc-risk-stress');
  DOM.rcRiskSpeed = document.getElementById('rc-risk-speed');
  DOM.gapAheadCar = document.getElementById('gap-ahead-car');
  DOM.gapAheadTime = document.getElementById('gap-ahead-time');
  DOM.gapBehindCar = document.getElementById('gap-behind-car');
  DOM.gapBehindTime = document.getElementById('gap-behind-time');
  DOM.statusBanner = document.getElementById('rc-status-banner');
  DOM.lapHistoryBody = document.getElementById('lap-history-body');
  DOM.eventList = document.getElementById('event-list');

  // Driver Behaviour Analysis
  DOM.rcBehBadge = document.getElementById('rc-beh-badge');
  DOM.rcBehScore = document.getElementById('rc-beh-score');
  DOM.rcBehConf = document.getElementById('rc-beh-conf');
  DOM.rcBehTh = document.getElementById('rc-beh-th');
  DOM.rcBehBr = document.getElementById('rc-beh-br');
  DOM.rcBehSmooth = document.getElementById('rc-beh-smooth');
  DOM.rcBehCons = document.getElementById('rc-beh-cons');
  DOM.rcBehExplanation = document.getElementById('rc-beh-explanation');
  DOM.rcBehFactors = document.getElementById('rc-beh-factors');
  DOM.rcBehEffect = document.getElementById('rc-beh-effect');
  
  // Engineer / Prescription Engine
  DOM.engCall = document.getElementById('eng-call');
  DOM.rxRecommended = document.getElementById('rx-recommended-action');
  DOM.rxReason = document.getElementById('rx-reason');
  DOM.rxGain = document.getElementById('rx-gain');
  DOM.rxTraffic = document.getElementById('rx-traffic');
  DOM.rxTemp = document.getElementById('rx-temp');
  DOM.rxOptPit = document.getElementById('rx-opt-pit');
  DOM.rxNextLap = document.getElementById('rx-next-lap');
  DOM.rxAltBox = document.getElementById('rx-alt-box');
  DOM.rxAltAction = document.getElementById('rx-alt-action');
  DOM.rxAltReason = document.getElementById('rx-alt-reason');
  DOM.rxAltGain = document.getElementById('rx-alt-gain');
  DOM.engOptLap = document.getElementById('eng-opt-lap');
  DOM.engOptTyre = document.getElementById('eng-opt-tyre');
  DOM.engOptFuel = document.getElementById('eng-opt-fuel');
  DOM.engConf = document.getElementById('eng-conf');
  
  // Battle
  DOM.battleTarget = document.getElementById('battle-target');
  DOM.battleStats = document.getElementById('battle-stats');
  DOM.battleUndercut = document.getElementById('battle-undercut');
  DOM.battleRec = document.getElementById('battle-rec');

  // Advanced Tyre Intelligence DOM Cache
  DOM.intelTabBtns = document.querySelectorAll('.intel-tab-btn');
  DOM.intelSubPanels = document.querySelectorAll('.intel-sub-panel');
  DOM.rcIntelActiveBadge = document.getElementById('rc-intel-active-badge');

  // Feature 1: 4-Tyre Matrix
  DOM.rcTyreImbalance = document.getElementById('rc-tyre-imbalance');
  DOM.rcLimitingTyre = document.getElementById('rc-limiting-tyre');
  DOM.rcCardFL = document.getElementById('rc-card-fl');
  DOM.rcCardFR = document.getElementById('rc-card-fr');
  DOM.rcCardRL = document.getElementById('rc-card-rl');
  DOM.rcCardRR = document.getElementById('rc-card-rr');
  DOM.rcFLRate = document.getElementById('rc-fl-rate');
  DOM.rcFLHealth = document.getElementById('rc-fl-health');
  DOM.rcFLTemp = document.getElementById('rc-fl-temp');
  DOM.rcFLThermalBadge = document.getElementById('rc-fl-thermal-badge');
  DOM.rcFLAccel = document.getElementById('rc-fl-accel');
  DOM.rcFRRate = document.getElementById('rc-fr-rate');
  DOM.rcFRHealth = document.getElementById('rc-fr-health');
  DOM.rcFRTemp = document.getElementById('rc-fr-temp');
  DOM.rcFRThermalBadge = document.getElementById('rc-fr-thermal-badge');
  DOM.rcFRAccel = document.getElementById('rc-fr-accel');
  DOM.rcRLRate = document.getElementById('rc-rl-rate');
  DOM.rcRLHealth = document.getElementById('rc-rl-health');
  DOM.rcRLTemp = document.getElementById('rc-rl-temp');
  DOM.rcRLThermalBadge = document.getElementById('rc-rl-thermal-badge');
  DOM.rcRLAccel = document.getElementById('rc-rl-accel');
  DOM.rcRRRate = document.getElementById('rc-rr-rate');
  DOM.rcRRHealth = document.getElementById('rc-rr-health');
  DOM.rcRRTemp = document.getElementById('rc-rr-temp');
  DOM.rcRRThermalBadge = document.getElementById('rc-rr-thermal-badge');
  DOM.rcRRAccel = document.getElementById('rc-rr-accel');

  // Feature 2: Dynamic Degradation
  DOM.rcDynRate = document.getElementById('rc-dyn-rate');
  DOM.rcDynTrendBadge = document.getElementById('rc-dyn-trend-badge');
  DOM.rcDynAccel = document.getElementById('rc-dyn-accel');
  DOM.rcDynHistory = document.getElementById('rc-dyn-history');

  // Feature 3: Track Degradation Map
  DOM.rcTrackCurSeg = document.getElementById('rc-track-cur-seg');
  DOM.rcTrackCurTag = document.getElementById('rc-track-cur-tag');
  DOM.rcTrackCurIntensity = document.getElementById('rc-track-cur-intensity');
  DOM.rcTrackCbCornering = document.getElementById('rc-track-cb-cornering');
  DOM.rcTrackCbThermal = document.getElementById('rc-track-cb-thermal');
  DOM.rcTrackCbBraking = document.getElementById('rc-track-cb-braking');
  DOM.rcTrackCbTraction = document.getElementById('rc-track-cb-traction');
  DOM.rcTrackStrip = document.getElementById('rc-track-strip');

  // Feature 4: Tyre Recovery
  DOM.rcRecPotential = document.getElementById('rc-rec-potential');
  DOM.rcRecCurrent = document.getElementById('rc-rec-current');
  DOM.rcRecManaged = document.getElementById('rc-rec-managed');
  DOM.rcRecRecoverable = document.getElementById('rc-rec-recoverable');
  DOM.rcRecExplanation = document.getElementById('rc-rec-explanation');

  // Feature 5: Opportunity Detector
  DOM.rcOppContainer = document.getElementById('rc-opp-container');
  DOM.rcOppPrimaryTitle = document.getElementById('rc-opp-primary-title');
  DOM.rcOppPrimaryConf = document.getElementById('rc-opp-primary-conf');
  DOM.rcOppPrimaryScore = document.getElementById('rc-opp-primary-score');
  DOM.rcOppPrimaryBenefit = document.getElementById('rc-opp-primary-benefit');
  DOM.rcOppPrimaryReason = document.getElementById('rc-opp-primary-reason');
  DOM.rcOppSecondaryList = document.getElementById('rc-opp-secondary-list');
  
  bindEvents();
}

let eventsBound = false;

function bindEvents() {
  if (eventsBound) return;
  eventsBound = true;

  DOM.btnStartRace.addEventListener('click', () => {
    DOM.startScreen.classList.remove('active');
    DOM.raceControl.classList.remove('hidden');
    
    // #1 Parc Fermé: Lock setup controls mid-race
    lockSetup();
    
    // Force browser reflow so SVG dimensions and path lengths are computable
    void DOM.raceControl.offsetHeight;
    
    // Initialize track only AFTER container is visible to fix SVG getTotalLength returning 0
    const circuit = CIRCUITS[raceConfig.trackId];
    if (circuit) {
      // Inject the dynamic paths into the track renderer
      initTrack(DOM.trackSvg, circuit.circuit.centerline, circuit.pitLane);
    } else {
      initTrack(DOM.trackSvg);
    }
    
    startRace(DOM.scenarioSelect.value);
  });
  
  DOM.btnRestartRace.addEventListener('click', () => {
    DOM.finishScreen.classList.remove('active');
    DOM.startScreen.classList.add('active');
    DOM.raceControl.classList.add('hidden');
    stopSimulation();
    unlockSetup();
  });
  
  DOM.btnPlayPause.addEventListener('click', () => {
    if (state.active) {
      stopSimulation();
      DOM.btnPlayPause.textContent = '▶';
    } else {
      lastTick = performance.now();
      state.active = true;
      simInterval = requestAnimationFrame(simulationLoop);
      DOM.btnPlayPause.textContent = '⏸';
    }
  });
  
  DOM.btnRestart.addEventListener('click', () => {
    stopSimulation();
    const circuit = CIRCUITS[raceConfig.trackId];
    if (circuit) {
      initTrack(DOM.trackSvg, circuit.circuit.centerline, circuit.pitLane);
    } else {
      initTrack(DOM.trackSvg);
    }
    startRace(DOM.scenarioSelect.value);
  });
  
  DOM.speedBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      DOM.speedBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      state.speed = parseFloat(e.target.dataset.speed);
    });
  });
  
  DOM.pitOpts.forEach(btn => {
    btn.addEventListener('click', (e) => {
      DOM.pitOpts.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
    });
  });
  
  DOM.btnManualPit.addEventListener('click', () => {
    if (state.userCar && !state.userCar.isPitting) {
      if (state.userCar.pitRequested) {
        state.userCar.pitRequested = false;
        DOM.btnManualPit.textContent = "PIT THIS LAP";
        DOM.btnManualPit.disabled = false;
        logEvent(`CAR 11 PIT REQUEST CANCELLED - STAYING OUT`, 'normal');
      } else {
        triggerUserPit();
      }
    }
  });
  
  DOM.btnWhy.addEventListener('click', () => {
    DOM.whyModal.classList.remove('hidden');
    populateWhyModal();
  });
  
  DOM.btnCloseWhy.addEventListener('click', () => {
    DOM.whyModal.classList.add('hidden');
  });

  // Advanced Tyre Intelligence Sub-Nav switching
  DOM.intelTabBtns?.forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetId = e.target.dataset.intelTarget;
      DOM.intelTabBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      DOM.intelSubPanels.forEach(p => {
        if (p.id === targetId) {
          p.style.display = 'flex';
          p.classList.add('active');
        } else {
          p.style.display = 'none';
          p.classList.remove('active');
        }
      });
      if (DOM.rcIntelActiveBadge) {
        DOM.rcIntelActiveBadge.textContent = e.target.textContent;
      }
    });
  });
}

function startRace(scenarioId) {
  stopSimulation();
  resetOptimalTracking();
  
  state.lap = 1;
  state.eventsLog = [];
  state.queuedEvents = [];
  state.lapHistory = {};
  state.pitHistory = [];
  state.penalties = [];
  
  const baseAirTemp = raceConfig.condition === 'WET' ? 22 : 30;
  const baseTrackTemp = raceConfig.condition === 'WET' ? 24 : 38;
  
  state.weatherHistory = {
    airTemp: [baseAirTemp],
    trackTemp: [baseTrackTemp],
    laps: [1]
  };
  
  state.raceEvent = 'GREEN';
  setRaceState('GREEN');
  
  const circuit = CIRCUITS[raceConfig.trackId];
  if (circuit) {
    state.totalLaps = circuit.raceLaps;
  } else {
    state.totalLaps = 61;
  }
  
  DOM.eventList.innerHTML = '';
  if (DOM.lapHistoryBody) DOM.lapHistoryBody.innerHTML = '';
  DOM.btnPlayPause.textContent = '⏸';
  if (DOM.btnManualPit) {
    DOM.btnManualPit.disabled = false;
    DOM.btnManualPit.textContent = 'PIT THIS LAP';
  }
  
  // Generate 20 cars with the user's selected grid position
  const basePace = circuit ? circuit.baseLapTimeSec : 94.0;
  const rawGridPos = DOM.gridPositionSelect ? parseInt(DOM.gridPositionSelect.value, 10) : 8;
  const playerGridPos = (!isNaN(rawGridPos) && rawGridPos >= 1 && rawGridPos <= 20) ? rawGridPos : 8;
  state.cars = generateGrid(playerGridPos, basePace);
  state.userCar = state.cars.find(c => c.isUser) || state.cars[0];
  if (state.userCar) state.userCar.isUser = true;
  
  applyScenario(scenarioId, state.cars, state);
  
  if (raceSetup) {
    state.userCar.compound = raceSetup.tyres.startingCompound;
    state.userCar.fuelPct = Math.min(100, raceSetup.fuel.startingFuelKg / 1.1); // Assuming 1.1kg = 1%
    
    // Apply aerodynamic/mechanical modifiers
    let setupOffset = 0;
    if (raceSetup.aerodynamics.downforceLevel === 'HIGH') setupOffset -= 1.2; // much faster in corners
    if (raceSetup.aerodynamics.downforceLevel === 'LOW') setupOffset += 0.8; // slower on generic/high-downforce tracks
    if (raceSetup.mechanical.balance === 'FRONT' || raceSetup.mechanical.balance === 'REAR') setupOffset += 0.2; // extreme balance costs time
    
    // Apply Energy Strategy (Aggressive = faster lap times, Conservative = slower)
    let energyOffset = 0;
    if (raceSetup.energy.deploymentStrategy === 'AGGRESSIVE') energyOffset -= 0.8;
    if (raceSetup.energy.deploymentStrategy === 'CONSERVATIVE') energyOffset += 0.8;
    
    state.userCar.setupOffsetTotal = setupOffset + energyOffset; // Store for HUD
    state.userCar.baseLapTime += state.userCar.setupOffsetTotal;
    
    state.userCar.setup = {
      downforceLevel: raceSetup.aerodynamics.downforceLevel,
      balance: raceSetup.mechanical.balance,
      energy: raceSetup.energy
    };
  }
  
  updateStrategyCompound(state.userCar.compound);
  
  syncCarsToSVG(state.cars, DOM.trackSvg);
  initTelemetryUI();
  
  // Build the shared track dynamics profile from telemetry (ONE TIME)
  buildTrackProfile(telemetryData);
  
  updatePositionsAndGaps();
  
  // Record Lap 0 (Grid) starting positions in lapHistory
  state.lapHistory[0] = {};
  state.cars.forEach(car => {
    state.lapHistory[0][car.id] = car.position;
  });

  renderCars(state.cars);
  updateUI();
  
  lastTick = performance.now();
  state.active = true;
  simInterval = requestAnimationFrame(simulationLoop);
  DOM.btnPlayPause.textContent = '⏸';
}

function stopSimulation() {
  state.active = false;
  if (simInterval) cancelAnimationFrame(simInterval);
}

function triggerUserPit() {
  const activePitBtn = document.querySelector('.pit-opt.active');
  const targetCompound = activePitBtn ? activePitBtn.dataset.pit : 'MEDIUM';
  
  state.userCar.pitRequested = true;
  state.userCar.targetCompound = targetCompound;
  
  // UI lock and logging
  console.log(`[MANUAL PIT REQUEST] Lap ${state.lap} - Compound: ${targetCompound.toUpperCase()}`);
  if (DOM.btnManualPit) {
    DOM.btnManualPit.disabled = false;
    DOM.btnManualPit.textContent = "PIT REQUESTED (CANCEL)";
  }
  
  if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
    state.userCar.refuelTargetKg = 0;
    logEvent(`CAR 11 PIT REQUESTED - COMPOUND CHANGE TO ${targetCompound.toUpperCase()}`, 'pit');
  } else {
    state.userCar.refuelTargetKg = calculateOptimalRefuelAmount(state.totalLaps - state.lap);
    logEvent(`CAR 11 PIT REQUESTED - COMPOUND CHANGE TO ${targetCompound.toUpperCase()}, +${state.userCar.refuelTargetKg.toFixed(1)}kg`, 'pit');
  }
}

function triggerAIPit(car) {
  const targetCompound = getAIFreshCompound(car.compound);
  car.pitRequested = true;
  car.targetCompound = targetCompound;
  
  if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
    car.refuelTargetKg = 0;
    logEvent(`CAR ${car.number} PIT REQUESTED - COMPOUND CHANGE TO ${targetCompound.toUpperCase()}`);
  } else {
    car.refuelTargetKg = calculateOptimalRefuelAmount(state.totalLaps - state.lap);
    logEvent(`CAR ${car.number} PIT REQUESTED - COMPOUND CHANGE TO ${targetCompound.toUpperCase()}, +${car.refuelTargetKg.toFixed(1)}kg`);
  }
}

function logEvent(msg, type = 'normal') {
  const el = document.createElement('div');
  el.className = `event-item ${type}`;
  el.textContent = `L${state.lap} - ${msg}`;
  DOM.eventList.prepend(el);
  state.eventsLog.unshift({ lap: state.lap, msg, type });
}

/**
 * Identify the nearest car ahead on the track progression for a given car,
 * correctly handling the circuit lap wrap.
 * 
 * Returns { carAhead, gapDistance, gapTime, forwardGap }
 */
function calculateCarAheadAndGap(car, allCars, trackLengthMeters) {
  if (!allCars || allCars.length <= 1 || car.isPitting || car.pitState) {
    return { carAhead: null, gapDistance: 9999, gapTime: 99.0, forwardGap: 1.0 };
  }

  const normProg = ((car.progress % 1.0) + 1.0) % 1.0;
  let minForwardGap = 1.0;
  let nearestCar = null;

  for (let i = 0; i < allCars.length; i++) {
    const other = allCars[i];
    if (other.id === car.id || other.isPitting || other.pitState) continue;

    const otherProg = ((other.progress % 1.0) + 1.0) % 1.0;
    let forward = otherProg - normProg;
    // Circular wrap: if forward <= 0, other is ahead across the lap boundary
    if (forward <= 0.00001) {
      forward += 1.0;
    }

    if (forward < minForwardGap) {
      minForwardGap = forward;
      nearestCar = other;
    }
  }

  if (!nearestCar || minForwardGap >= 0.999) {
    return { carAhead: null, gapDistance: 9999, gapTime: 99.0, forwardGap: 1.0 };
  }

  const gapDistance = minForwardGap * trackLengthMeters;
  const currentSpeedMps = Math.max((car.speed || 100) / 3.6, 10.0);
  const gapTime = gapDistance / currentSpeedMps;

  return { carAhead: nearestCar, gapDistance, gapTime, forwardGap: minForwardGap };
}

const BASE_SIM_SPEED = 2.5; // Increases base speed so 1x-20x feels responsive, fast, and exciting

function simulationLoop(now) {
  if (!state.active) return;
  
  const rawDt = ((now - lastTick) / 1000) * state.speed * BASE_SIM_SPEED;
  lastTick = now;
  // Allow high-speed simulation scaling up to 20x (effective 50x) while preventing browser tab-inactive spikes
  const maxDt = Math.max(1.0, (state.speed * BASE_SIM_SPEED / 30) * 1.5);
  const dt = Math.min(maxDt, Math.max(0.001, rawDt));
  
  let newLapCrossed = false;
  
  state.cars.forEach(car => {
    const pitConfig = getPitLaneConfig();
    const entryProgress = pitConfig ? pitConfig.entryProgress : 0.95;
    const exitProgress = pitConfig ? pitConfig.exitProgress : 0.05;

    // Track normalized circuit progress in [0, 1)
    const normProg = ((car.progress % 1) + 1) % 1;
    const prevNormProg = car.prevNormProg !== undefined ? car.prevNormProg : normProg;

    // Detect if car has launched from the grid on Lap 1
    if (!car.hasLaunched) {
      if (car.currentLap > 1 || car.lapsCompleted > 0 || car.progress >= 1.0 || (prevNormProg > 0.95 && normProg < 0.15)) {
        car.hasLaunched = true;
      }
    }

    // ── Check Pit Lane Entry ──
    // A car enters pit lane if:
    // 1. Pit is requested and car is not already in the pit lane
    // 2. Car has launched (is racing on the track, not sitting in grid slot before race start)
    // 3. Car reaches or crosses entryProgress on this lap (handles all speeds 1x-20x)
    if (car.pitRequested && !car.isPitting && !car.pitState) {
      const reachedEntry = car.hasLaunched && (
        // Standard crossing into pit entry
        (prevNormProg < entryProgress && normProg >= entryProgress) ||
        // Jumped across finish line at high sim speed
        (prevNormProg > 0.85 && normProg < 0.20 && prevNormProg < entryProgress) ||
        // Proximity entry (if user clicked pit while car is right near entry window)
        (normProg >= entryProgress && normProg <= Math.min(0.99, entryProgress + 0.08))
      );

      if (reachedEntry) {
        console.log(`[ENTER PIT] Car ${car.number} entering pit lane at normProg=${normProg.toFixed(3)}.`);
        car.pitRequested = false;
        car.pitState = 'IN';
        car.isPitting = true;
        car.pitProgress = 0;
        car.boxTarget = getPitBoxTarget(car.team);
        
        if (car.isUser && DOM.btnManualPit) {
          DOM.btnManualPit.disabled = true;
          DOM.btnManualPit.textContent = "PITTING...";
        }
        
        logEvent(`CAR ${car.number} ENTERED PIT LANE - BOX BOX BOX`, 'pit');
        
        // Apply pit penalty to totalRaceTime
        car.totalRaceTime += 28.0;
        
        return; // Skip normal progress update this frame
      }
    }
    
    if (car.pitState) {
      if (car.pitState === 'IN') {
        car.pitProgress += (dt / 10.0) * car.boxTarget;
        if (car.pitProgress >= car.boxTarget) {
          console.log(`[TYRE CHANGE] Car ${car.number} in pit box.`);
          car.pitProgress = car.boxTarget;
          car.pitState = 'STOP';
          car.stopTimer = 0;
          
          car.compound = car.targetCompound;
          car.tyreAge = 0; 
          const newWin = COMPOUND_THERMAL_WINDOWS[car.compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
          car.tyreTemp = newWin.opt;
          car.thermalLoad = 0;
          car.thermalDegradation = 0;
          car.thermalState = {
            tyreTemp: newWin.opt,
            optimalTemp: newWin.opt,
            blisterTemp: newWin.blister,
            deltaT: 0,
            thermalZ: 0,
            thermalPenalty: 0,
            blisterFactor: 1.0,
            overheatFactor: 1.0
          };
          car.uncooledHighSpeedTime = 0;
          car.pitStops++;
          if (car.isUser) updateStrategyCompound(car.compound);
        }
      } else if (car.pitState === 'STOP') {
        car.stopTimer += dt;
        const requiredTime = Math.max(TYRE_CHANGE_TIME_SEC, (car.refuelTargetKg || 0) / REFUEL_RATE_KG_PER_SEC);
        if (car.stopTimer >= requiredTime) {
          console.log(`[EXIT PIT] Car ${car.number} leaving pit box.`);
          car.pitState = 'OUT';
          
          state.pitHistory.push({
            lap: state.lap,
            carId: car.id,
            carNumber: car.number,
            color: car.color,
            duration: car.stopTimer,
            compound: car.compound
          });
          
          if (car.refuelTargetKg) {
            car.fuelPct = Math.min(100, car.fuelPct + (car.refuelTargetKg / 1.1));
          }
        }
      } else if (car.pitState === 'OUT') {
        car.pitProgress += (dt / 10.0) * (1 - car.boxTarget);
        if (car.pitProgress >= 1.0) {
          console.log(`[PIT STATE RESET] Car ${car.number} pit sequence fully completed.`);
          car.pitState = null;
          car.isPitting = false;
          car.pitProgress = 0;
          car.progress = exitProgress;
          car.prevNormProg = exitProgress;
          
          if (car.isUser && DOM.btnManualPit) {
            DOM.btnManualPit.disabled = false;
            DOM.btnManualPit.textContent = "PIT THIS LAP";
            console.log(`[READY FOR NEXT PIT] User manual pit button re-enabled.`);
          }

          logEvent(`CAR ${car.number} PIT EXIT - REJOINED TRACK (P${car.position || '-'}) ON ${car.compound}`, 'pit');
          
          if (exitProgress < entryProgress) {
            car.lapStartTime = car.totalRaceTime;
            car.currentLap++;
            car.lapsCompleted++;
            car.tyreAge++; 
            if (car.isUser) {
              newLapCrossed = true;
              state.lap = car.currentLap;
            }
            if (evaluateAIPit(car, state.totalLaps)) {
              triggerAIPit(car);
            }
          }
        }
      }
      return; // Skip updating normal progress while in pit lane
    }
    
    // ── Continuous Aerodynamic Interference / Dirty Air (ALL 20 CARS) ──
    const circuitLengthMeters = (CIRCUITS[raceConfig.trackId]?.lengthKm || 5.0) * 1000;
    const { carAhead, gapDistance, gapTime } = calculateCarAheadAndGap(car, state.cars, circuitLengthMeters);

    // Continuous smoothstep dirty air factor
    // gapTime >= 3.0s -> 0; gapTime <= 0.8s -> 1.0
    const DIRTY_AIR_START = 3.0;
    const DIRTY_AIR_FULL = 0.8;
    const DIRTY_AIR_MAX = 1.0;

    let targetInterference = 0;
    if (gapTime <= DIRTY_AIR_FULL) {
      targetInterference = DIRTY_AIR_MAX;
    } else if (gapTime >= DIRTY_AIR_START) {
      targetInterference = 0;
    } else {
      const x = Math.min(1.0, Math.max(0, (DIRTY_AIR_START - gapTime) / (DIRTY_AIR_START - DIRTY_AIR_FULL)));
      targetInterference = x * x * (3 - 2 * x);
    }

    // Side-by-side / overlapping protection: if cars are alongside (<5m), rear wake is reduced
    if (gapDistance < 5.0) {
      const alongsideFactor = Math.max(0.2, gapDistance / 5.0);
      targetInterference *= alongsideFactor;
    }

    // Maximum 3% aerodynamic penalty scaled at high speed (> 150 km/h)
    const MAX_AERO_PENALTY = 0.03;
    const currentSpeedForAero = car.speed !== undefined ? car.speed : 100;
    const aeroSpeedFactor = Math.min(1.0, Math.max(0, (currentSpeedForAero - 150) / 150.0));
    const targetAeroPenalty = MAX_AERO_PENALTY * targetInterference * aeroSpeedFactor;

    // Per-car EMA smoothing (AERO_SMOOTHING = 0.10) to eliminate rapid speed oscillations
    const AERO_SMOOTHING = 0.10;
    car.aeroInterference = (car.aeroInterference !== undefined ? car.aeroInterference : 0) + AERO_SMOOTHING * (targetInterference - (car.aeroInterference !== undefined ? car.aeroInterference : 0));
    car.aeroPenalty = (car.aeroPenalty !== undefined ? car.aeroPenalty : 0) + AERO_SMOOTHING * (targetAeroPenalty - (car.aeroPenalty !== undefined ? car.aeroPenalty : 0));
    car.aeroTarget = targetAeroPenalty;
    car.gapToAheadTime = gapTime;
    car.gapToAheadDistance = gapDistance;
    car.carAheadId = carAhead ? carAhead.id : null;
    car.carAheadNumber = carAhead ? carAhead.number : null;

    // ── Continuous Multi-Load Thermal Evolution ──
    const win = COMPOUND_THERMAL_WINDOWS[car.compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
    const optTemp = win.opt;
    const blisterTemp = win.blister;
    if (car.tyreTemp === undefined) car.tyreTemp = optTemp;
    if (car.thermalDegradation === undefined) car.thermalDegradation = 0;

    const currentSpeed = (car.speed !== undefined && !isNaN(car.speed)) ? car.speed : 100;
    const ambientTemp = 32.0; // Track ambient reference in °C
    
    // 1. Progressive speed heat generation: rolling carcass flex + high-speed aerodynamic friction
    const baseRollingHeat = 0.85 * (currentSpeed / 200.0);
    const speedFactor = Math.max(0, (currentSpeed - 130) / 170.0);
    const betaSpeed = 1.35;
    const speedHeatRate = baseRollingHeat + betaSpeed * Math.pow(speedFactor, 1.4);

    // 2. Braking load heat generation: deceleration frictional energy transferred into tyres
    const brakeFactor = Math.min(1.0, Math.max(0, (car.prevBrake || 0) / 5.0));
    const betaBrake = 0.8;
    const brakeHeatRate = betaBrake * brakeFactor;

    // 3. Cornering load heat generation: lateral shear stress from carcass deformation
    const cornerFactor = Math.min(1.0, Math.pow(Math.min(currentSpeed, 220) / 190.0, 2));
    const betaCorner = 0.75;
    const cornerHeatRate = betaCorner * cornerFactor;

    // Physical modifiers: compound hysteretic friction, tyre wear thinning, dirty air turbulence, driver behaviour
    const compoundHeatScale = car.compound === 'SOFT' ? 1.05 : (car.compound === 'HARD' ? 0.95 : 1.0);
    const ageHeatScale = 1.0 + 0.007 * Math.min(35, car.tyreAge || 0);
    const trafficHeatScale = 1.0 + 0.12 * (car.aeroInterference || 0);
    const behaviourHeatScale = car.driverBehaviour?.thermalModifier || 1.0;

    const totalHeatRate = (speedHeatRate + brakeHeatRate + cornerHeatRate) * compoundHeatScale * ageHeatScale * trafficHeatScale * behaviourHeatScale;

    // Continuous cooling rate: proportional to (T_tyre - T_ambient) with airflow velocity
    const airVelocityScale = 0.8 + 0.4 * (currentSpeed / 250.0);
    const gammaCool = 0.030 * airVelocityScale;
    const coolingRate = Math.max(0, gammaCool * (car.tyreTemp - ambientTemp));

    // Continuous integration: T_next = T_current + (HeatRate - CoolingRate) * dt
    const netThermalRate = totalHeatRate - coolingRate;
    car.tyreTemp = Math.max(65, Math.min(140, car.tyreTemp + netThermalRate * dt));

    const deltaT = Math.max(0, car.tyreTemp - optTemp);
    const thermalZ = deltaT / 12.0;

    // Evaluate smooth progressive thermal penalty
    const thermalRes = calculateThermalPenalty(car.compound, car.tyreAge, car.tyreTemp);
    car.thermalState = {
      tyreTemp: car.tyreTemp,
      optimalTemp: optTemp,
      blisterTemp,
      deltaT,
      thermalZ,
      thermalPenalty: thermalRes.thermalPenalty,
      blisterFactor: thermalRes.blisterFactor,
      overheatFactor: thermalRes.overheatFactor
    };
    car.thermalPenalty = thermalRes.thermalPenalty;
    car.thermalDegradation = thermalRes.thermalPenalty;

    // Calculate pacing including thermal degradation variable, dirty air stress & driver behaviour stress modifier
    let degDelta = getDegradationDelta(car.compound, car.tyreAge, car.setup, car.thermalState, car.aeroInterference || 0, car.driverBehaviour?.tyreStressModifier || 1.0);
    
    // Fuel effect: cars get faster as they burn fuel
    // 1% fuel = ~1.1kg. activePrior is s/kg.
    const fuelPriorValue = parseFloat(activePrior) || 0.05;
    const kgBurned = (100 - car.fuelPct) * 1.1;
    const fuelEffect = kgBurned * fuelPriorValue;
    
    // Track Evolution effect (track gets faster as time goes on, slope is negative s/sec)
    const trackEvol = (modelData?.track_evolution?.slope_s_per_sec || 0) * car.totalRaceTime;
    
    // Aerodynamic performance penalty on lap time in high-speed sections
    const highSpeedFactor = Math.min(1.0, Math.max(0, (currentSpeed - 160) / 160.0));
    const effectiveAeroPenalty = (car.aeroPenalty || 0) * highSpeedFactor;
    const aeroLapPenalty = car.baseLapTime * effectiveAeroPenalty * 0.5;

    let lapTime = car.baseLapTime + degDelta - fuelEffect + trackEvol + aeroLapPenalty;
    
    if (state.raceEvent === 'SC') lapTime *= 1.4;
    else if (state.raceEvent === 'VSC') lapTime *= 1.2;
    
    car.totalRaceTime += dt;
    
    // ── Shared Physics Evaluation (ALL CARS) ──
    // Evaluate physics using current simulated speed & continuous aero penalty
    const physics = evaluateCarPhysics(
      car.progress,
      currentSpeed,
      car.prevBrake || 0,
      car.prevThrottle || 80,
      car.aeroPenalty || 0
    );
    
    // Smooth Rate-Limited Acceleration (Physical realism & removes waving)
    const responseTime = 0.5; // seconds to reach target
    // Exponential smoothing for target speed tracking (unconditionally stable at all dt and sim speeds)
    const accelAlpha = 1.0 - Math.exp(-dt / responseTime);
    car.speed = currentSpeed + (physics.targetSpeed - currentSpeed) * accelAlpha;
    
    // Physical floor: an active racing F1 car on circuit never drops to 0 km/h (0 only when stopped in pit box)
    const minTrackSpeed = (car.pitState === 'STOP') ? 0 : 55;
    car.speed = Math.max(minTrackSpeed, (isNaN(car.speed) || !isFinite(car.speed)) ? 100 : car.speed);
    
    car.brake = physics.brake;
    car.throttle = physics.throttle;
    car.gear = physics.gear;
    car.targetSpeed = physics.targetSpeed;
    car.prevBrake = car.brake;
    car.prevThrottle = car.throttle;

    // ── 5-Indicator Tyre Health & Puncture Risk Engine (ALL 20 CARS) ──
    car.tyreHealth = computeTyreHealth(car, modelData);

    // ── Driver Behaviour & Driving Style Analysis Engine (ALL 20 CARS) ──
    updateDriverBehaviour(car, dt, state.raceEvent);

    // ── Dynamic Degradation Rate + Acceleration (ALL 20 CARS) ──
    updateDynamicDegradation(car, dt);

    // ── Individual Tyre Degradation Matrix (ALL 20 CARS) ──
    car.individualTyres = computeIndividualTyres(car, modelData);

    if (isNaN(lapTime) || !isFinite(lapTime) || lapTime <= 10) lapTime = car.baseLapTime || 94.0;
    
    // ── Update Progress ──
    // Track progression is governed by lap pacing (dt / lapTime) modulated by
    // the car's instantaneous speed relative to the circuit average speed.
    // This allows the car to visibly brake in corners and sprint on straights
    // while guaranteeing exactly 1.0 progress completes per lapTime without snail crawling.
    const avgProfileSpeed = getProfileAvgSpeed() || 160;
    const speedRatio = Math.max(0.4, Math.min(2.5, (car.speed || 120) / avgProfileSpeed));
    let progressIncrement = speedRatio * (dt / lapTime);
    if (isNaN(progressIncrement) || !isFinite(progressIncrement)) {
      progressIncrement = dt / (car.baseLapTime || 94.0);
    }
    
    car.progress += progressIncrement;
    
    // Fuel burn calculation
    const burnRateKgPerLap = getFuelBurnRate(car.setup);
    const burnRatePctPerLap = burnRateKgPerLap / 1.1;
    car.fuelPct -= (burnRatePctPerLap * (dt / lapTime));
    
    // Lap crossing: based on Time now
    if (car.totalRaceTime - car.lapStartTime >= lapTime) {
      const thisLapTime = car.totalRaceTime - car.lapStartTime;
      car.lapStartTime = car.totalRaceTime;
      car.lastLapTime = thisLapTime;
      car.lapTimes.push(thisLapTime);
      
      // Lap History Log for User
      if (car.isUser && DOM.lapHistoryBody) {
        const m = Math.floor(thisLapTime / 60);
        const s = (thisLapTime % 60).toFixed(3).padStart(6, '0');
        const lapTimeString = `${m}:${s}`;
        
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--color-carbon)';
        row.innerHTML = `
          <td style="padding: 6px; color: #000; font-weight: 700;">${state.lap}</td>
          <td style="padding: 6px; color: ${car.position === 1 ? 'var(--color-ember)' : '#000'}; font-weight: 700;">P${car.position}</td>
          <td style="padding: 6px; color: ${car.tyreAge > 60 ? 'var(--red)' : '#000'}; font-weight: 600;">${Math.max(0, 100 - car.tyreAge).toFixed(1)}%</td>
          <td style="padding: 6px; color: #000; font-weight: 700;">${lapTimeString}</td>
        `;
        DOM.lapHistoryBody.prepend(row);
      }
      if (!car.bestLapTime || thisLapTime < car.bestLapTime) {
        car.bestLapTime = thisLapTime;
      }
      
      car.progress -= 1.0;
      if (car.progress < 0) car.progress = 0;
      car.currentLap++;
      car.lapsCompleted++;
      car.tyreAge++;

      // Record this car's position upon completing this lap
      if (!state.lapHistory) state.lapHistory = {};
      const completedLapNum = car.lapsCompleted;
      if (!state.lapHistory[completedLapNum]) {
        state.lapHistory[completedLapNum] = {};
      }
      state.lapHistory[completedLapNum][car.id] = car.position;
      
      if (car.isUser) {
        newLapCrossed = true;
        state.lap = car.currentLap;
        
        // Update weather slightly each lap
        const lastAir = state.weatherHistory.airTemp[state.weatherHistory.airTemp.length - 1];
        const lastTrack = state.weatherHistory.trackTemp[state.weatherHistory.trackTemp.length - 1];
        
        // Random walk
        const newAir = lastAir + (Math.random() * 0.4 - 0.2);
        // Track temp follows air but with more variance
        const newTrack = lastTrack + (newAir - lastAir) * 1.5 + (Math.random() * 0.6 - 0.3);
        
        state.weatherHistory.airTemp.push(newAir);
        state.weatherHistory.trackTemp.push(newTrack);
        state.weatherHistory.laps.push(state.lap);
      }
      
      // Random chance for AI penalty
      if (!car.isUser && Math.random() < 0.005) { // 0.5% per lap
        const type = Math.random() > 0.5 ? 'Track Limits' : 'Collision';
        state.penalties.push({
          lap: state.lap,
          carId: car.id,
          carNumber: car.number,
          type: type,
          time: 5
        });
        car.totalRaceTime += 5.0; // Apply 5s penalty
        const turn = Math.floor(Math.random() * 15) + 1;
        const msg = type === 'Track Limits' 
          ? (Math.random() > 0.5 ? `CAR ${car.number} TIME DELETED - TRACK LIMITS AT TURN ${turn}` : `BLACK AND WHITE FLAG FOR CAR ${car.number} - TRACK LIMITS`)
          : `CAR ${car.number} 5 SECOND TIME PENALTY - CAUSING A COLLISION AT TURN ${turn}`;
        logEvent(msg, type === 'Track Limits' ? 'flag' : 'penalty');
      }
      
      // Check AI Pit
      if (evaluateAIPit(car, state.totalLaps)) {
        triggerAIPit(car);
      }
    }

    // Cache normalized progress for next frame crossing detection
    car.prevNormProg = ((car.progress % 1) + 1) % 1;
  });
  
  if (newLapCrossed) {
    handleLapEvents();
  }
  
  updatePositionsAndGaps();
  renderCars(state.cars);
  updateUI();
  
  if (state.lap > state.totalLaps) {
    finishRace();
    return;
  }
  
  simInterval = requestAnimationFrame(simulationLoop);
}

function handleLapEvents() {
  // Check queued events
  const pending = state.queuedEvents.find(e => e.lap === state.lap);
  if (pending) {
    state.raceEvent = pending.type;
    state.eventLapsRemaining = pending.duration;
    setRaceState(pending.type);
    logEvent(`INCIDENT - ${pending.type.toUpperCase()} DEPLOYED`, 'sc');
    
    state.queuedEvents = state.queuedEvents.filter(e => e.lap !== state.lap);
  }
  
  if (state.eventLapsRemaining > 0) {
    state.eventLapsRemaining--;
    if (state.eventLapsRemaining === 0) {
      logEvent(`GREEN FLAG - TRACK CLEAR`, 'green');
      state.raceEvent = 'GREEN';
      setRaceState('GREEN');
    }
  } else if (state.raceEvent === 'GREEN') {
    // Random chance of SC
    if (Math.random() < 0.02) {
      state.raceEvent = 'SC';
      state.eventLapsRemaining = 3;
      setRaceState('SC');
      logEvent(`INCIDENT - SAFETY CAR DEPLOYED`, 'sc');
    }
  }
}

function updatePositionsAndGaps() {
  // Sort cars by laps completed (desc) then progress (desc)
  // Or simply by totalRaceTime if everyone is roughly on the same lap
  // To be accurate: sort by (lapsCompleted + progress) descending
  state.cars.sort((a, b) => {
    const aTotal = a.lapsCompleted + a.progress;
    const bTotal = b.lapsCompleted + b.progress;
    if (bTotal === aTotal) return a.startingPos - b.startingPos;
    return bTotal - aTotal;
  });
  
  // Calculate relative gaps
  state.cars.forEach((car, index) => {
    if (car.position > index + 1) {
      logEvent(`CAR ${car.number} OVERTAKES FOR P${index + 1}`);
      // Swap lanes
      car.lane = (car.lane === 1) ? -1 : 1; 
    } else if (car.position < index + 1) {
      car.lane = 0; // return to racing line eventually
    }
    car.position = index + 1;
  });
  
  if (!state.lapHistory) state.lapHistory = {};
  
  // Create history entry for current lap if it doesn't exist
  if (!state.lapHistory[state.lap]) {
    state.lapHistory[state.lap] = {};
  }
  
  // Live in-lap position tracking for current lap
  state.cars.forEach(car => {
    // Only write if car hasn't already recorded a discrete lap-completion value for this lap
    if (state.lapHistory[state.lap][car.id] === undefined || car.lapsCompleted < state.lap) {
      state.lapHistory[state.lap][car.id] = car.position;
    }
  });
}

function updateUI() {
  const u = state.userCar;
  if (!u) return;
  
  DOM.rcLap.textContent = `${Math.min(state.lap, state.totalLaps)} / ${state.totalLaps}`;
  DOM.rcPos.textContent = `P${u.position}`;
  DOM.rcTyre.textContent = u.compound;
  DOM.rcAge.textContent = Math.max(1, u.tyreAge);
  
  DOM.rcFuelBar.style.width = `${Math.max(0, u.fuelPct)}%`;
  
  let fuelText = 'SAFE';
  if (u.fuelPct < 15) { fuelText = 'WARNING'; DOM.rcFuelBar.style.background = 'var(--amber)'; }
  if (u.fuelPct < 5) { fuelText = 'CRITICAL'; DOM.rcFuelBar.style.background = 'var(--red)'; }
  DOM.rcFuelText.textContent = `${(u.fuelPct * 1.1).toFixed(1)}kg (${fuelText})`;
  
  const tyreDeg = getDegradationDelta(u.compound, u.tyreAge, u.setup, u.thermalState);
  const tyreDegCI = getDegradationUncertainty(u.compound, u.tyreAge, u.setup);
  
  const setupVal = u.setupOffsetTotal || 0;
  const setupStr = setupVal !== 0 ? ` (Setup: ${setupVal > 0 ? '+' : ''}${setupVal.toFixed(1)}s)` : '';
  
  if (DOM.rcDelta) DOM.rcDelta.textContent = `+${tyreDeg.toFixed(2)}s ±${tyreDegCI.toFixed(2)}s${setupStr}`;
  if (DOM.rcDegRate) DOM.rcDegRate.textContent = `${getMarginalDegRate(u.compound, u.tyreAge, u.setup).toFixed(2)}s/L`;

  // ── 5-Indicator Tyre Health Panel & Puncture Risk Engine (MAIN CAR HUD) ──
  const health = u.tyreHealth || computeTyreHealth(u, modelData);
  if (health) {
    if (DOM.rcHealthGrip) {
      DOM.rcHealthGrip.textContent = `${health.gripLevel}%`;
      DOM.rcHealthGrip.style.color = health.gripLevel > 70 ? 'var(--green)' : (health.gripLevel > 40 ? 'var(--amber)' : 'var(--red)');
    }
    if (DOM.rcHealthTread) {
      DOM.rcHealthTread.textContent = `${health.treadRemaining}%`;
      DOM.rcHealthTread.style.color = health.treadRemaining > 50 ? 'var(--color-carbon)' : (health.treadRemaining > 20 ? 'var(--amber)' : 'var(--red)');
    }
    if (DOM.rcHealthDegRate) {
      DOM.rcHealthDegRate.textContent = health.degRateFormatted;
    }
    if (DOM.rcHealthEnergy) {
      DOM.rcHealthEnergy.textContent = health.tyreEnergyText;
    }
    if (DOM.rcPunctureBadge) {
      DOM.rcPunctureBadge.textContent = `${health.punctureRiskScore}% ${health.punctureRiskLevel}`;
      DOM.rcPunctureBadge.style.color = health.punctureRiskColor;
      DOM.rcPunctureBadge.style.background = health.punctureRiskBg;
      DOM.rcPunctureBadge.style.borderColor = health.punctureRiskColor;
    }
    if (DOM.rcPanelGripBar) DOM.rcPanelGripBar.style.width = `${health.gripLevel}%`;
    if (DOM.rcPanelTreadBar) DOM.rcPanelTreadBar.style.width = `${health.treadRemaining}%`;
    if (DOM.rcPanelPunctureScore) {
      DOM.rcPanelPunctureScore.textContent = `${health.punctureRiskScore}%`;
      DOM.rcPanelPunctureScore.style.color = health.punctureRiskColor;
    }
    if (DOM.rcPanelPunctureLevel) {
      DOM.rcPanelPunctureLevel.textContent = `${health.punctureRiskLevel} HAZARD`;
      DOM.rcPanelPunctureLevel.style.color = health.punctureRiskColor;
    }
    if (DOM.rcPanelTyreBadge) {
      DOM.rcPanelTyreBadge.textContent = u.compound;
      if (u.compound === 'SOFT') {
        DOM.rcPanelTyreBadge.style.background = '#fecaca';
        DOM.rcPanelTyreBadge.style.color = '#991b1b';
      } else if (u.compound === 'HARD') {
        DOM.rcPanelTyreBadge.style.background = '#f3f4f6';
        DOM.rcPanelTyreBadge.style.color = '#000';
      } else {
        DOM.rcPanelTyreBadge.style.background = '#fef08a';
        DOM.rcPanelTyreBadge.style.color = '#854d0e';
      }
    }
    if (health.components) {
      if (DOM.rcRiskAge) DOM.rcRiskAge.textContent = `${health.components.ageRisk}%`;
      if (DOM.rcRiskCliff) DOM.rcRiskCliff.textContent = `${health.components.cliffRisk}%`;
      if (DOM.rcRiskThermal) DOM.rcRiskThermal.textContent = `${health.components.thermalRisk}%`;
      if (DOM.rcRiskBlister) DOM.rcRiskBlister.textContent = `${health.components.blisterRisk}%`;
      if (DOM.rcRiskStress) DOM.rcRiskStress.textContent = `${health.components.stressRisk}%`;
      if (DOM.rcRiskSpeed) DOM.rcRiskSpeed.textContent = `${health.components.speedRisk}%`;
    }
  }

  // ── Driver Behaviour Analysis Panel ──
  const beh = u.driverBehaviour;
  if (beh) {
    if (DOM.rcBehBadge) {
      DOM.rcBehBadge.textContent = beh.state;
      DOM.rcBehBadge.className = '';
      if (beh.state === 'ATTACK') DOM.rcBehBadge.className = 'beh-badge-attack';
      else if (beh.state === 'BALANCED') DOM.rcBehBadge.className = 'beh-badge-balanced';
      else if (beh.state === 'CONSERVATIVE') DOM.rcBehBadge.className = 'beh-badge-conservative';
      else if (beh.state === 'DEFENSIVE') DOM.rcBehBadge.className = 'beh-badge-defensive';
      else if (beh.state === 'OVERDRIVING') DOM.rcBehBadge.className = 'beh-badge-overdriving';
      DOM.rcBehBadge.style.fontSize = '0.65rem';
      DOM.rcBehBadge.style.fontWeight = '800';
      DOM.rcBehBadge.style.padding = '2px 6px';
      DOM.rcBehBadge.style.borderRadius = '4px';
      DOM.rcBehBadge.style.border = '1px solid var(--color-carbon)';
    }
    if (DOM.rcBehScore) {
      DOM.rcBehScore.textContent = Math.round(beh.score);
    }
    if (DOM.rcBehConf) {
      DOM.rcBehConf.textContent = beh.confidence;
      DOM.rcBehConf.style.color = beh.confidence === 'HIGH' ? 'var(--green)' : (beh.confidence === 'MEDIUM' ? 'var(--amber)' : '#888');
    }
    if (DOM.rcBehTh) {
      DOM.rcBehTh.textContent = beh.throttleAggression > 0.65 ? 'HIGH' : (beh.throttleAggression > 0.35 ? 'MED' : 'LOW');
      DOM.rcBehTh.style.color = beh.throttleAggression > 0.65 ? 'var(--red)' : (beh.throttleAggression > 0.35 ? 'var(--color-carbon)' : 'var(--green)');
    }
    if (DOM.rcBehBr) {
      DOM.rcBehBr.textContent = beh.brakingAggression > 0.65 ? 'HIGH' : (beh.brakingAggression > 0.35 ? 'MED' : 'LOW');
      DOM.rcBehBr.style.color = beh.brakingAggression > 0.65 ? 'var(--red)' : (beh.brakingAggression > 0.35 ? 'var(--color-carbon)' : 'var(--green)');
    }
    if (DOM.rcBehSmooth) {
      DOM.rcBehSmooth.textContent = beh.inputSharpness < 0.35 ? 'SMOOTH' : (beh.inputSharpness < 0.65 ? 'MED' : 'SHARP');
      DOM.rcBehSmooth.style.color = beh.inputSharpness < 0.35 ? 'var(--green)' : (beh.inputSharpness < 0.65 ? 'var(--color-carbon)' : 'var(--red)');
    }
    if (DOM.rcBehCons) {
      DOM.rcBehCons.textContent = beh.inconsistency < 0.35 ? 'HIGH' : (beh.inconsistency < 0.65 ? 'MED' : 'LOW');
      DOM.rcBehCons.style.color = beh.inconsistency < 0.35 ? 'var(--green)' : (beh.inconsistency < 0.65 ? 'var(--color-carbon)' : 'var(--amber)');
    }
    if (DOM.rcBehFactors) {
      const factorsText = (beh.dominantFactors && beh.dominantFactors.length > 0) ? beh.dominantFactors.join(', ') : 'Balanced inputs';
      DOM.rcBehFactors.textContent = factorsText;
    }
    if (DOM.rcBehEffect) {
      const sign = (beh.stressEffectPct > 0) ? '+' : '';
      DOM.rcBehEffect.textContent = `${sign}${(beh.stressEffectPct || 0).toFixed(1)}% tyre stress`;
      if (beh.stressEffectPct > 1.5) {
        DOM.rcBehEffect.style.color = 'var(--red, #dc2626)';
      } else if (beh.stressEffectPct < -0.5) {
        DOM.rcBehEffect.style.color = 'var(--green, #16a34a)';
      } else {
        DOM.rcBehEffect.style.color = 'var(--color-carbon, #000)';
      }
    }
    if (DOM.rcBehExplanation) {
      DOM.rcBehExplanation.textContent = beh.explanation || 'Monitoring telemetry patterns...';
    }
  }
  
  const rcTyreTemp = document.getElementById('rc-tyre-temp');
  if (u.tyreTemp) {
    const tempVal = Math.round(u.tyreTemp);
    const win = COMPOUND_THERMAL_WINDOWS[u.compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
    let statusText = 'OPT';
    let statusColor = 'var(--green)';
    if (u.tyreTemp > win.blister) {
      statusText = 'HOT 🔥';
      statusColor = 'var(--red)';
    } else if (u.tyreTemp > win.opt + 10) {
      statusText = 'HOT 🔥';
      statusColor = 'var(--red)';
    } else if (u.tyreTemp > win.opt + 4) {
      statusText = 'WARM';
      statusColor = 'var(--amber)';
    }
    if (rcTyreTemp) {
      rcTyreTemp.textContent = `${tempVal}°C (${statusText})`;
      rcTyreTemp.style.color = statusColor;
    }
    if (DOM.rcPanelTyreTemp) {
      DOM.rcPanelTyreTemp.textContent = `${tempVal}°C (${statusText})`;
      DOM.rcPanelTyreTemp.style.color = statusColor;
    }
  }
  
  // Gaps
  const userIdx = state.cars.findIndex(c => c.isUser);
  if (userIdx > 0) {
    const ahead = state.cars[userIdx - 1];
    // Gap approx based on progress diff * laptime
    const gap = (ahead.progress - u.progress) + (ahead.lapsCompleted - u.lapsCompleted);
    DOM.gapAheadCar.textContent = `P${ahead.position} (#${ahead.number})`;
    DOM.gapAheadTime.textContent = `+${(gap * getBaseLapTime()).toFixed(1)}s`;
  } else {
    DOM.gapAheadCar.textContent = 'LEADER';
    DOM.gapAheadTime.textContent = '-';
  }
  
  if (userIdx < state.cars.length - 1) {
    const behind = state.cars[userIdx + 1];
    const gap = (u.progress - behind.progress) + (behind.lapsCompleted - u.lapsCompleted);
    DOM.gapBehindCar.textContent = `P${behind.position} (#${behind.number})`;
    DOM.gapBehindTime.textContent = `-${(gap * getBaseLapTime()).toFixed(1)}s`;
  } else {
    DOM.gapBehindCar.textContent = 'LAST';
    DOM.gapBehindTime.textContent = '-';
  }
  
  // Status Banner
  if (state.raceEvent !== 'GREEN') {
    DOM.statusBanner.className = 'rc-status-banner sc';
    DOM.statusBanner.textContent = state.raceEvent === 'SC' ? 'SAFETY CAR' : 'VSC';
  } else {
    DOM.statusBanner.className = 'rc-status-banner';
    DOM.statusBanner.textContent = 'GREEN FLAG';
  }
  
  // Update Live Telemetry
  updateTelemetryUI(u, telemetryData, modelData);
  
  // ── Advanced Tyre Intelligence Updates (5 Features) ──
  const trackMap = computeTrackDegradationMap(raceConfig.trackId || 'singapore', u, modelData);
  state.trackDegradationMap = trackMap;
  const currentSeg = getActiveTrackSegment(trackMap, u.progress);

  const recoveryInfo = evaluateTyreRecovery(u, modelData, 2);
  u.tyreRecovery = recoveryInfo;

  const oppReport = detectRaceOpportunities(u, state.cars, state.lap, state.totalLaps, state.raceEvent, modelData);
  state.opportunityReport = oppReport;

  // Strategy Prescription Engine
  const rx = getPrescription(u.compound, u.tyreAge, state.lap, u.fuelPct, u.setup, state.cars, u.thermalState, u.pitStops, u.driverBehaviour, recoveryInfo, oppReport);
  if (DOM.engCall) {
    if (rx.action.includes('PIT') && rx.targetCompound) {
      DOM.engCall.textContent = `${rx.action} → ${rx.targetCompound}`;
      DOM.engCall.className = 'engineer-call pit';
    } else {
      DOM.engCall.textContent = rx.action;
      DOM.engCall.className = 'engineer-call';
    }
  }

  if (DOM.rxRecommended) DOM.rxRecommended.textContent = rx.recommendedAction;
  if (DOM.rxReason) DOM.rxReason.textContent = rx.reason;
  if (DOM.rxGain) {
    if (rx.projectedGain === null || rx.projectedGain === undefined || isNaN(rx.projectedGain)) {
      DOM.rxGain.textContent = 'N/A';
    } else {
      DOM.rxGain.textContent = rx.projectedGain > 0 ? `+${rx.projectedGain.toFixed(1)}s` : `${rx.projectedGain.toFixed(1)}s`;
    }
  }
  if (DOM.rxTraffic) {
    DOM.rxTraffic.textContent = rx.trafficRisk;
    DOM.rxTraffic.style.color = rx.trafficRisk === 'HIGH' ? '#dc2626' : (rx.trafficRisk === 'MEDIUM' ? '#d97706' : '#16a34a');
  }
  if (DOM.rxTemp) {
    DOM.rxTemp.textContent = rx.tyreTemperature;
    DOM.rxTemp.style.color = rx.tyreTemperature === 'BLISTERING' ? '#dc2626' : (rx.tyreTemperature === 'HOT' ? '#ea580c' : (rx.tyreTemperature === 'WARM' ? '#d97706' : '#16a34a'));
  }
  if (DOM.rxOptPit) {
    if (rx.optimalLap === 'N/A' || !rx.optimalLap) {
      DOM.rxOptPit.textContent = 'N/A';
    } else if (String(rx.optimalLap).toUpperCase().includes('FINISH')) {
      DOM.rxOptPit.textContent = 'RACE FINISH';
    } else {
      const targetTyreStr = rx.targetCompound ? ` (${rx.targetCompound})` : '';
      DOM.rxOptPit.textContent = `LAP ${rx.optimalLap}${targetTyreStr}`.toUpperCase();
    }
  }
  if (DOM.rxNextLap) {
    if (!rx.nextDecisionLap) {
      DOM.rxNextLap.textContent = 'AS SCHEDULED';
    } else if (typeof rx.nextDecisionLap === 'string') {
      DOM.rxNextLap.textContent = rx.nextDecisionLap.toUpperCase();
    } else {
      DOM.rxNextLap.textContent = `RE-EVALUATE LAP ${rx.nextDecisionLap}`.toUpperCase();
    }
  }

  // Update Alternative Box (Locked space with visibility prevents vertical bouncing)
  if (DOM.rxAltBox) {
    if (rx.alternative) {
      DOM.rxAltBox.style.visibility = 'visible';
      DOM.rxAltBox.style.opacity = '1';
      if (DOM.rxAltAction) DOM.rxAltAction.textContent = `${rx.alternative.action} → ${rx.alternative.targetCompound}`;
      if (DOM.rxAltReason) DOM.rxAltReason.textContent = rx.alternative.reason;
      if (DOM.rxAltGain) {
        const altGainVal = (rx.alternative.projectedGain !== null && rx.alternative.projectedGain !== undefined && !isNaN(rx.alternative.projectedGain))
          ? (rx.alternative.projectedGain > 0 ? `+${rx.alternative.projectedGain.toFixed(1)}s` : `${rx.alternative.projectedGain.toFixed(1)}s`)
          : '+0.0s';
        DOM.rxAltGain.textContent = `${altGainVal} (${rx.alternative.trafficRisk || 'LOW'})`;
      }
    } else {
      DOM.rxAltBox.style.visibility = 'hidden';
      DOM.rxAltBox.style.opacity = '0';
    }
  }

  // ── Update 5 Advanced Tyre Intelligence HUD Panels ──
  // 1. 4-Tyre Matrix
  const indTyres = u.individualTyres || computeIndividualTyres(u, modelData);
  if (indTyres) {
    if (DOM.rcTyreImbalance) DOM.rcTyreImbalance.textContent = indTyres.imbalanceMessage;
    if (DOM.rcLimitingTyre) {
      DOM.rcLimitingTyre.textContent = `WORST: ${indTyres.limitingTyre}`;
      DOM.rcLimitingTyre.style.color = '#991b1b';
      DOM.rcLimitingTyre.style.background = '#fee2e2';
    }

    const corners = [
      { key: 'FL', card: DOM.rcCardFL, rateEl: DOM.rcFLRate, healthEl: DOM.rcFLHealth, tempEl: DOM.rcFLTemp, badgeEl: DOM.rcFLThermalBadge, accelEl: DOM.rcFLAccel },
      { key: 'FR', card: DOM.rcCardFR, rateEl: DOM.rcFRRate, healthEl: DOM.rcFRHealth, tempEl: DOM.rcFRTemp, badgeEl: DOM.rcFRThermalBadge, accelEl: DOM.rcFRAccel },
      { key: 'RL', card: DOM.rcCardRL, rateEl: DOM.rcRLRate, healthEl: DOM.rcRLHealth, tempEl: DOM.rcRLTemp, badgeEl: DOM.rcRLThermalBadge, accelEl: DOM.rcRLAccel },
      { key: 'RR', card: DOM.rcCardRR, rateEl: DOM.rcRRRate, healthEl: DOM.rcRRHealth, tempEl: DOM.rcRRTemp, badgeEl: DOM.rcRRThermalBadge, accelEl: DOM.rcRRAccel }
    ];

    corners.forEach(c => {
      const data = indTyres[c.key];
      if (data) {
        if (c.rateEl) c.rateEl.textContent = `+${data.degradationRate.toFixed(3)} s/L`;
        if (c.healthEl) {
          c.healthEl.textContent = `${data.health}%`;
          c.healthEl.style.color = data.health > 70 ? 'var(--green)' : (data.health > 45 ? 'var(--amber)' : 'var(--red)');
        }
        if (c.tempEl) c.tempEl.textContent = `${Math.round(data.temperature)}°C`;
        if (c.badgeEl) {
          c.badgeEl.textContent = data.thermalState;
          if (data.thermalState === 'HOT' || data.thermalState === 'BLISTER') {
            c.badgeEl.style.background = '#fee2e2';
            c.badgeEl.style.color = '#991b1b';
            c.badgeEl.style.borderColor = '#ef4444';
          } else if (data.thermalState === 'WARM') {
            c.badgeEl.style.background = '#fef3c7';
            c.badgeEl.style.color = '#92400e';
            c.badgeEl.style.borderColor = '#f59e0b';
          } else {
            c.badgeEl.style.background = '#dcfce7';
            c.badgeEl.style.color = '#166534';
            c.badgeEl.style.borderColor = '#22c55e';
          }
        }
        if (c.accelEl) {
          const s = data.degradationAcceleration >= 0 ? '+' : '';
          c.accelEl.textContent = `${s}${data.degradationAcceleration.toFixed(3)}`;
        }
        if (c.card) {
          if (c.key === indTyres.limitingTyre && indTyres.worstRatio >= 1.15) {
            c.card.classList.add('worst-tyre-highlight');
          } else {
            c.card.classList.remove('worst-tyre-highlight');
          }
        }
      }
    });
  }

  // 2. Dynamic Degradation Rate + Acceleration
  const dynDeg = u.dynamicDegradation || updateDynamicDegradation(u, 0.05);
  if (dynDeg) {
    if (DOM.rcDynRate) DOM.rcDynRate.textContent = dynDeg.rateFormatted;
    if (DOM.rcDynTrendBadge) {
      DOM.rcDynTrendBadge.textContent = `${dynDeg.trendSymbol} ${dynDeg.trend}`;
      DOM.rcDynTrendBadge.style.color = dynDeg.trendColor;
      DOM.rcDynTrendBadge.style.background = dynDeg.trend === 'SEVERE ACCELERATION' ? '#fee2e2' : (dynDeg.trend === 'ACCELERATING' ? '#fef08a' : '#dcfce7');
      DOM.rcDynTrendBadge.style.borderColor = dynDeg.trendColor;
    }
    if (DOM.rcDynAccel) DOM.rcDynAccel.textContent = dynDeg.accelFormatted;
    if (DOM.rcDynHistory) DOM.rcDynHistory.textContent = dynDeg.historyTrace;
  }

  // 3. Track Degradation Map
  if (currentSeg) {
    if (DOM.rcTrackCurSeg) DOM.rcTrackCurSeg.textContent = currentSeg.name.toUpperCase();
    if (DOM.rcTrackCurTag) {
      DOM.rcTrackCurTag.textContent = currentSeg.primaryTag;
      DOM.rcTrackCurTag.style.color = currentSeg.color;
      DOM.rcTrackCurTag.style.borderColor = currentSeg.color;
    }
    if (DOM.rcTrackCurIntensity) {
      DOM.rcTrackCurIntensity.textContent = `${currentSeg.intensity}/100`;
      DOM.rcTrackCurIntensity.style.color = currentSeg.color;
    }
    if (DOM.rcTrackCbCornering) DOM.rcTrackCbCornering.textContent = `${currentSeg.contributors.cornering}%`;
    if (DOM.rcTrackCbThermal) DOM.rcTrackCbThermal.textContent = `${currentSeg.contributors.thermal}%`;
    if (DOM.rcTrackCbBraking) DOM.rcTrackCbBraking.textContent = `${currentSeg.contributors.braking}%`;
    if (DOM.rcTrackCbTraction) DOM.rcTrackCbTraction.textContent = `${currentSeg.contributors.traction}%`;
  }
  if (DOM.rcTrackStrip && trackMap && (!DOM.rcTrackStrip.children.length || state.lap !== DOM.rcTrackStrip._lastLap)) {
    DOM.rcTrackStrip._lastLap = state.lap;
    DOM.rcTrackStrip.innerHTML = '';
    trackMap.forEach(seg => {
      const segSpan = document.createElement('div');
      const pctWidth = (seg.endPos - seg.startPos) * 100;
      segSpan.style.width = `${pctWidth}%`;
      segSpan.style.height = '100%';
      segSpan.style.background = seg.color;
      segSpan.title = `${seg.name} (${seg.intensity}/100 - ${seg.primaryTag})`;
      DOM.rcTrackStrip.appendChild(segSpan);
    });
  }

  // 4. Tyre Recovery Intelligence
  if (recoveryInfo) {
    if (DOM.rcRecPotential) {
      DOM.rcRecPotential.textContent = `${recoveryInfo.recoveryPotentialPct}%`;
      DOM.rcRecPotential.style.color = recoveryInfo.recoveryPotentialPct >= 50 ? 'var(--green)' : 'var(--amber)';
    }
    if (DOM.rcRecCurrent) DOM.rcRecCurrent.textContent = `+${recoveryInfo.currentDegRate.toFixed(3)} s/L`;
    if (DOM.rcRecManaged) DOM.rcRecManaged.textContent = `+${recoveryInfo.managedDegRate.toFixed(3)} s/L`;
    if (DOM.rcRecRecoverable) DOM.rcRecRecoverable.textContent = recoveryInfo.recoverableFormatted;
    if (DOM.rcRecExplanation) DOM.rcRecExplanation.textContent = recoveryInfo.explanation;
  }

  // 5. Race Event Opportunity Detector
  if (oppReport) {
    const pOpp = oppReport.primaryOpportunity;
    if (pOpp) {
      if (DOM.rcOppPrimaryTitle) DOM.rcOppPrimaryTitle.textContent = pOpp.title;
      if (DOM.rcOppPrimaryConf) DOM.rcOppPrimaryConf.textContent = `${pOpp.confidence} CONF`;
      if (DOM.rcOppPrimaryScore) DOM.rcOppPrimaryScore.textContent = `${pOpp.score}%`;
      if (DOM.rcOppPrimaryBenefit) DOM.rcOppPrimaryBenefit.textContent = pOpp.benefit;
      if (DOM.rcOppPrimaryReason) DOM.rcOppPrimaryReason.textContent = pOpp.reason;
    }
    if (DOM.rcOppSecondaryList && oppReport.opportunities.length > 1) {
      const secOpps = oppReport.opportunities.slice(1, 3);
      DOM.rcOppSecondaryList.innerHTML = secOpps.map(op => `
        <div style="background: rgba(0,0,0,0.02); border: 1px solid rgba(0,0,0,0.08); border-radius: 4px; padding: 4px 6px; font-size: 0.58rem; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-weight: 700; color: var(--color-carbon);">${op.title}</span>
          <strong style="color: var(--green); font-family: var(--font-mono);">${op.score}%</strong>
        </div>
      `).join('');
    }
  }
  
  if (DOM.engOptLap) {
    if (rx.optimalLap === 'N/A' || !rx.optimalLap) {
      DOM.engOptLap.textContent = 'N/A';
    } else if (String(rx.optimalLap).toUpperCase().includes('FINISH')) {
      DOM.engOptLap.textContent = 'RACE FINISH';
    } else {
      DOM.engOptLap.textContent = `LAP ${rx.optimalLap}`;
    }
  }
  if (DOM.engOptTyre) DOM.engOptTyre.textContent = rx.nextCompound;
  if (DOM.engOptFuel) DOM.engOptFuel.textContent = `+${(rx.fuelNeeded || 0).toFixed(1)}kg`;
  if (DOM.engConf) DOM.engConf.textContent = rx.confidence;
  
  // Broadcast state to any listeners (e.g. Research Pages)
  stateListeners.forEach(cb => cb(state));
}

function populateWhyModal() {
  const u = state.userCar;
  const rx = getPrescription(u.compound, u.tyreAge, state.lap, u.fuelPct, u.setup, state.cars, u.thermalState, u.pitStops, u.driverBehaviour, u.tyreRecovery, state.opportunityReport);
  
  const candidatesRows = (rx.candidates || []).map(c => {
    const isPrimary = c.rank === 1;
    const isAlt = c.rank === 2;
    const badge = isPrimary 
      ? `<span style="background:#dcfce7; color:#14532d; border:1.5px solid #16a34a; font-weight:800; font-size:0.7rem; padding:2px 6px; border-radius:3px;">PRIMARY</span>`
      : (isAlt ? `<span style="background:#e5e7eb; color:#000; font-weight:800; font-size:0.7rem; padding:2px 6px; border-radius:3px; border:1px solid #000;">ALT</span>` : `<span style="color:#000; font-weight:700; font-size:0.7rem;">#${c.rank}</span>`);
    
    const trafficColor = c.trafficRisk === 'HIGH' ? '#dc2626' : (c.trafficRisk === 'MEDIUM' ? '#d97706' : '#16a34a');
    
    return `
      <tr style="border-bottom: 1px solid #e5e7eb; background: ${isPrimary ? '#f0fdf4' : (isAlt ? '#fffbeb' : '#ffffff')};">
        <td style="padding: 8px 6px; text-align: center;">${badge}</td>
        <td style="padding: 8px 6px; font-weight: 700; color: #000;">${c.action}</td>
        <td style="padding: 8px 6px; text-align: center;">${c.stopLap ? 'Lap ' + c.stopLap : '—'}</td>
        <td style="padding: 8px 6px; text-align: center; font-weight: 700;">${c.targetCompound}</td>
        <td style="padding: 8px 6px; text-align: right; font-family: monospace;">${c.totalTime.toFixed(1)}s</td>
        <td style="padding: 8px 6px; text-align: right; font-family: monospace; font-weight: 700; color: ${c.deltaBest === 0 ? '#16a34a' : '#dc2626'};">${c.deltaBest === 0 ? 'BEST' : '+' + c.deltaBest.toFixed(1) + 's'}</td>
        <td style="padding: 8px 6px; text-align: center; font-weight: 700; color: ${trafficColor};">${c.trafficRisk}</td>
      </tr>
    `;
  }).join('');

  const optPitDisplay = (rx.optimalLap === 'N/A' || !rx.optimalLap)
    ? 'N/A'
    : (String(rx.optimalLap).toUpperCase().includes('FINISH')
      ? 'RACE FINISH'
      : `LAP ${rx.optimalLap}${rx.targetCompound ? ' (' + rx.targetCompound + ')' : ''}`);

  const html = `
    <div style="margin-bottom: 16px; padding: 14px; background: #f8fafc; border: 2px solid #000; border-radius: 6px; box-shadow: 0 4px 0 #000;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
        <span style="font-size: 0.72rem; font-weight: 900; letter-spacing: 1px; color: #000;">PRIMARY PRESCRIPTION</span>
        <div style="display: flex; gap: 6px; flex-wrap: wrap;">
          <span style="font-size: 0.72rem; font-weight: 800; background: #f1f5f9; border:1px solid #000; color: #000; padding: 2px 6px; border-radius: 4px;">OPTIMAL PIT: ${optPitDisplay}</span>
          <span style="font-size: 0.72rem; font-weight: 800; background: #fef08a; border:1px solid #000; color: #000; padding: 2px 6px; border-radius: 4px;">NEXT DECISION: ${rx.nextDecisionLap || 'AS SCHEDULED'}</span>
          <span style="font-size: 0.72rem; font-weight: 800; background: #e2e8f0; border:1px solid #000; color: #000; padding: 2px 6px; border-radius: 4px;">PROJECTED GAIN: ${rx.projectedGain !== null && rx.projectedGain !== undefined && !isNaN(rx.projectedGain) ? '+' + rx.projectedGain.toFixed(1) + 's' : 'N/A'}</span>
        </div>
      </div>
      <div style="font-size: 1.3rem; font-weight: 900; color: #000; margin-bottom: 4px;">${rx.action} — ${rx.targetCompound}</div>
      <div style="font-size: 0.9rem; font-weight: 700; color: #0284c7; margin-bottom: 8px;">${rx.recommendedAction}</div>
      <div style="font-size: 0.85rem; color: #1e293b; line-height: 1.45; border-left: 3px solid #000; padding-left: 10px;">${rx.reason}</div>
    </div>

    <div style="margin-bottom: 16px;">
      <div style="font-size: 0.75rem; font-weight: 900; letter-spacing: 1px; color: #000; margin-bottom: 8px; text-transform: uppercase;">
        EVALUATED CANDIDATE STRATEGIES (DETERMINISTIC SIMULATION)
      </div>
      <div style="overflow-x: auto; border: 1px solid #000; border-radius: 4px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem; text-align: left;">
          <thead>
            <tr style="background: #f1f5f9; color: #000; font-weight: 800; border-bottom: 2px solid #000; font-size: 0.72rem; text-transform: uppercase;">
              <th style="padding: 8px 6px; text-align: center;">Rank</th>
              <th style="padding: 8px 6px;">Candidate Action</th>
              <th style="padding: 8px 6px; text-align: center;">Pit Lap</th>
              <th style="padding: 8px 6px; text-align: center;">Compound</th>
              <th style="padding: 8px 6px; text-align: right;">Total Race Time</th>
              <th style="padding: 8px 6px; text-align: right;">Delta</th>
              <th style="padding: 8px 6px; text-align: center;">Exit Traffic</th>
            </tr>
          </thead>
          <tbody>
            ${candidatesRows}
          </tbody>
        </table>
      </div>
    </div>

    <div style="background: #ffffff; border: 1px solid #000; border-radius: 6px; padding: 12px; font-size: 0.82rem; line-height: 1.5; color: #000;">
      <div style="font-weight: 800; margin-bottom: 6px; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px;">Physics & Telemetry Live State:</div>
      <ul style="margin: 0; padding-left: 18px;">
        <li><strong>Tyre Degradation Pace Loss:</strong> Current ${u.compound} tyre is losing <strong>+${getDegradationDelta(u.compound, u.tyreAge, u.setup).toFixed(2)}s/lap</strong>.</li>
        <li><strong>Thermal State:</strong> ${rx.tyreTemperature} (${rx.tyreTempC}°C) — Thermal Penalty: +${(u.thermalState?.thermalPenalty || 0).toFixed(2)}s/lap.</li>
        <li><strong>Pit-Lane Loss:</strong> Estimated stop cost under ${state.raceEvent} is <strong>${rx.pitLoss.toFixed(1)}s</strong>.</li>
        <li><strong>Traffic Density:</strong> Pit-exit traffic window evaluated as <strong>${rx.trafficRisk}</strong> (${rx.trafficDetails || 'Clean track'}).</li>
        <li><strong>Fuel Burn-off:</strong> Car weight delta is lowering baseline lap time at ${(getFuelBurnRate(u.setup) * 0.05).toFixed(3)}s/lap.</li>
      </ul>
    </div>
  `;
  document.getElementById('why-content').innerHTML = html;
}

function finishRace() {
  logEvent('SESSION FINISHED', 'status');
  stopSimulation();
  DOM.raceControl.classList.add('hidden');
  DOM.finishScreen.classList.add('active');
  
  const u = state.userCar;
  document.getElementById('finish-pos').textContent = `P${u.position}`;
  document.getElementById('finish-start-pos').textContent = `P${u.startingPos}`;
  
  const gained = u.startingPos - u.position;
  const elGained = document.getElementById('finish-gained');
  elGained.textContent = gained > 0 ? `+${gained}` : gained;
  elGained.className = gained >= 0 ? 'positive' : 'negative';
  
  document.getElementById('finish-stops').textContent = u.pitStops;
  
  // Counterfactual strategy review
  const rec = getRecommendation(u.compound, u.tyreAge, state.lap, u.fuelPct, u.setup);
  document.getElementById('finish-time-saved').textContent = `+${(u.pitStops * 4.2).toFixed(1)}s`;
  
  // Update what-if text if it exists
  const whatIf = document.getElementById('finish-what-if');
  if (whatIf) {
    whatIf.innerHTML = `
      <div style="margin-top:20px; font-size:14px; color:var(--text-dim);">
        <strong>Research Validation:</strong> Model Confidence: ${rec.strategyConfidence} (${rec.confNote})
      </div>
    `;
  }
}

export function destroySimulation() {
  stopSimulation();
}
