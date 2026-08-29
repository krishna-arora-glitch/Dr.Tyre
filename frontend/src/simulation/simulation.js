/**
 * simulation.js — Live Simulation Orchestrator
 * Fully overhauled for the Race Control dashboard.
 */

import { initTrack, syncCarsToSVG, renderCars, getPitLaneConfig, getPitBoxTarget } from './track.js';
import { generateGrid, evaluateAIPit, getAIFreshCompound } from './competitors.js';
import { applyScenario } from './scenarios.js';
import { 
  initStrategy, updateStrategyCompound, getDegradationDelta, 
  getMarginalDegRate, getRecommendation, getFuelRemaining, 
  getTotalLaps, setRaceState, optimal_stop_lap, evaluate_undercut,
  setWeatherCondition, calculateOptimalRefuelAmount, REFUEL_RATE_KG_PER_SEC, TYRE_CHANGE_TIME_SEC 
} from './strategy.js';
import { drawSparkline } from './sparkline.js'; 
import { CIRCUITS } from './circuits.js';
import { raceSetup } from '../setup/setup.js';

let modelData = null;
let simInterval = null;
let lastTick = 0;

const BASE_LAP_TIME = 94.0; // seconds

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

const DOM = {};

export function initSimulation(data) {
  modelData = data;
  initStrategy(data);
  
  // Cache DOM
  DOM.startScreen = document.getElementById('start-screen');
  DOM.raceControl = document.getElementById('race-control-layout');
  DOM.finishScreen = document.getElementById('finish-screen');
  DOM.whyModal = document.getElementById('why-modal');
  DOM.btnStartRace = document.getElementById('btn-start-race');
  DOM.btnRestartRace = document.getElementById('btn-restart-race');
  DOM.scenarioSelect = document.getElementById('scenario-select');
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
  DOM.gapAheadCar = document.getElementById('gap-ahead-car');
  DOM.gapAheadTime = document.getElementById('gap-ahead-time');
  DOM.gapBehindCar = document.getElementById('gap-behind-car');
  DOM.gapBehindTime = document.getElementById('gap-behind-time');
  DOM.statusBanner = document.getElementById('rc-status-banner');
  DOM.eventList = document.getElementById('event-list');
  
  // Engineer
  DOM.engCall = document.getElementById('eng-call');
  DOM.engOptLap = document.getElementById('eng-opt-lap');
  DOM.engOptTyre = document.getElementById('eng-opt-tyre');
  DOM.engOptFuel = document.getElementById('eng-opt-fuel');
  DOM.engConf = document.getElementById('eng-conf');
  
  // Battle
  DOM.battleTarget = document.getElementById('battle-target');
  DOM.battleStats = document.getElementById('battle-stats');
  DOM.battleUndercut = document.getElementById('battle-undercut');
  DOM.battleRec = document.getElementById('battle-rec');
  
  bindEvents();
}

function bindEvents() {
  DOM.btnStartRace.addEventListener('click', () => {
    DOM.startScreen.classList.remove('active');
    DOM.raceControl.classList.remove('hidden');
    
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
      triggerUserPit();
    }
  });
  
  DOM.btnWhy.addEventListener('click', () => {
    DOM.whyModal.classList.remove('hidden');
    populateWhyModal();
  });
  
  DOM.btnCloseWhy.addEventListener('click', () => {
    DOM.whyModal.classList.add('hidden');
  });
}

function startRace(scenarioId) {
  state.lap = 1;
  state.eventsLog = [];
  state.queuedEvents = [];
  state.raceEvent = 'GREEN';
  setRaceState('GREEN');
  
  const circuit = CIRCUITS[raceConfig.trackId];
  if (circuit) {
    state.totalLaps = circuit.raceLaps;
  } else {
    state.totalLaps = 61;
  }
  
  DOM.eventList.innerHTML = '';
  DOM.btnPlayPause.textContent = '⏸';
  
  // Generate 20 cars
  // In the real demo, user starts P8
  const basePace = circuit ? circuit.baseLapTimeSec : 94.0;
  state.cars = generateGrid(8, basePace);
  state.userCar = state.cars.find(c => c.isUser);
  
  applyScenario(scenarioId, state.cars, state);
  
  if (raceSetup) {
    state.userCar.compound = raceSetup.tyres.startingCompound;
    state.userCar.fuelPct = Math.min(100, raceSetup.fuel.startingFuelKg / 1.1); // Assuming 1.1kg = 1%
    
    // Apply aerodynamic/mechanical modifiers
    let setupOffset = 0;
    if (raceSetup.aerodynamics.downforceLevel === 'HIGH') setupOffset -= 0.3; // faster in corners
    if (raceSetup.aerodynamics.downforceLevel === 'LOW') setupOffset += 0.2; // slightly slower overall on generic tracks
    if (raceSetup.mechanical.balance === 'FRONT') setupOffset += 0.1;
    
    state.userCar.baseLapTime += setupOffset;
  }
  
  updateStrategyCompound(state.userCar.compound);
  
  syncCarsToSVG(state.cars, DOM.trackSvg);
  
  logEvent(`RACE STARTED - ${scenarioId} MODE`);
  
  lastTick = performance.now();
  state.active = true;
  simInterval = requestAnimationFrame(simulationLoop);
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
  
  if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
    state.userCar.refuelTargetKg = 0;
    logEvent(`CAR #11 PIT REQUESTED - ${state.userCar.compound} to ${targetCompound} (No Refuelling)`, 'pit');
  } else {
    state.userCar.refuelTargetKg = calculateOptimalRefuelAmount(state.totalLaps - state.lap);
    logEvent(`CAR #11 PIT REQUESTED - ${state.userCar.compound} to ${targetCompound}, +${state.userCar.refuelTargetKg.toFixed(1)}kg`, 'pit');
  }
}

function triggerAIPit(car) {
  const targetCompound = getAIFreshCompound(car.compound);
  car.pitRequested = true;
  car.targetCompound = targetCompound;
  
  if (raceSetup && !raceSetup.ruleset.refuellingDuringRace) {
    car.refuelTargetKg = 0;
    logEvent(`CAR #${car.number} PIT REQUESTED - ${car.compound} to ${targetCompound}`);
  } else {
    car.refuelTargetKg = calculateOptimalRefuelAmount(state.totalLaps - state.lap);
    logEvent(`CAR #${car.number} PIT REQUESTED - ${car.compound} to ${targetCompound}, +${car.refuelTargetKg.toFixed(1)}kg`);
  }
}

function logEvent(msg, type = 'normal') {
  const el = document.createElement('div');
  el.className = `event-item ${type}`;
  el.textContent = `L${state.lap} - ${msg}`;
  DOM.eventList.prepend(el);
  state.eventsLog.unshift({ lap: state.lap, msg, type });
}

function simulationLoop(now) {
  if (!state.active) return;
  
  const dt = ((now - lastTick) / 1000) * state.speed;
  lastTick = now;
  
  let newLapCrossed = false;
  
  state.cars.forEach(car => {
    const pitConfig = getPitLaneConfig();
    const entryProgress = pitConfig ? pitConfig.entryProgress : 0.95;
    const exitProgress = pitConfig ? pitConfig.exitProgress : 0.05;

    if (car.pitRequested && car.progress >= entryProgress && car.progress < entryProgress + 0.05) {
      car.pitRequested = false;
      car.pitState = 'IN';
      car.pitProgress = 0;
      car.boxTarget = getPitBoxTarget(car.team);
      
      // Apply pit penalty to totalRaceTime
      car.totalRaceTime += 28.0; 
      
      return; // Skip normal progress update this frame
    }
    
    if (car.pitState) {
      if (car.pitState === 'IN') {
        car.pitProgress += (dt / 10.0) * car.boxTarget;
        if (car.pitProgress >= car.boxTarget) {
          car.pitProgress = car.boxTarget;
          car.pitState = 'STOP';
          car.stopTimer = 0;
          
          car.compound = car.targetCompound;
          car.tyreAge = 0; 
          car.pitStops++;
          if (car.isUser) updateStrategyCompound(car.compound);
        }
      } else if (car.pitState === 'STOP') {
        car.stopTimer += dt;
        const requiredTime = Math.max(TYRE_CHANGE_TIME_SEC, (car.refuelTargetKg || 0) / REFUEL_RATE_KG_PER_SEC);
        if (car.stopTimer >= requiredTime) {
          car.pitState = 'OUT';
          if (car.refuelTargetKg) {
            car.fuelPct = Math.min(100, car.fuelPct + (car.refuelTargetKg / 1.1));
          }
        }
      } else if (car.pitState === 'OUT') {
        car.pitProgress += (dt / 10.0) * (1 - car.boxTarget);
        if (car.pitProgress >= 1.0) {
          car.pitState = null;
          car.pitProgress = 0;
          car.progress = exitProgress;
          
          if (exitProgress < entryProgress) {
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
    
    // Calculate pacing
    let degDelta = getDegradationDelta(car.compound, car.tyreAge);
    // Fuel effect: cars get faster as they burn fuel (approx 0.05s per kg)
    const fuelEffect = ((100 - car.fuelPct) * 0.05); 
    
    let lapTime = car.baseLapTime + degDelta - fuelEffect;
    
    if (state.raceEvent === 'SC') lapTime *= 1.4;
    else if (state.raceEvent === 'VSC') lapTime *= 1.2;
    
    const progressDelta = dt / lapTime;
    car.progress += progressDelta;
    car.totalRaceTime += dt;
    
    // Fuel burn (110kg for 61 laps -> ~1.8kg/lap -> ~1.6% per lap)
    car.fuelPct -= (1.6 * progressDelta);
    
    // Lap crossing
    if (car.progress >= 1.0) {
      car.progress -= 1.0;
      car.currentLap++;
      car.lapsCompleted++;
      car.tyreAge++;
      
      if (car.isUser) {
        newLapCrossed = true;
        state.lap = car.currentLap;
      }
      
      // Check AI Pit
      if (evaluateAIPit(car, state.totalLaps)) {
        triggerAIPit(car);
      }
    }
  });
  
  if (newLapCrossed) {
    handleLapEvents();
  }
  
  updatePositionsAndGaps();
  updateUI();
  renderCars(state.cars);
  
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
    logEvent(`${pending.type} DEPLOYED`, 'sc');
    
    state.queuedEvents = state.queuedEvents.filter(e => e.lap !== state.lap);
  }
  
  if (state.eventLapsRemaining > 0) {
    state.eventLapsRemaining--;
    if (state.eventLapsRemaining === 0) {
      logEvent(`TRACK CLEAR`, 'green');
      state.raceEvent = 'GREEN';
      setRaceState('GREEN');
    }
  } else if (state.raceEvent === 'GREEN') {
    // Random chance of SC
    if (Math.random() < 0.02) {
      state.raceEvent = 'SC';
      state.eventLapsRemaining = 3;
      setRaceState('SC');
      logEvent(`SAFETY CAR DEPLOYED`, 'sc');
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
    return bTotal - aTotal;
  });
  
  // Calculate relative gaps
  state.cars.forEach((car, index) => {
    if (car.position > index + 1) {
      logEvent(`CAR #${car.number} overtakes for P${index + 1}`);
      // Swap lanes
      car.lane = (car.lane === 1) ? -1 : 1; 
    } else if (car.position < index + 1) {
      car.lane = 0; // return to racing line eventually
    }
    car.position = index + 1;
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
  
  DOM.rcDelta.textContent = `+${getDegradationDelta(u.compound, u.tyreAge).toFixed(2)}s`;
  DOM.rcDegRate.textContent = `${getMarginalDegRate(u.compound, u.tyreAge).toFixed(2)}s/L`;
  
  // Gaps
  const userIdx = state.cars.findIndex(c => c.isUser);
  if (userIdx > 0) {
    const ahead = state.cars[userIdx - 1];
    // Gap approx based on progress diff * laptime
    const gap = (ahead.progress - u.progress) + (ahead.lapsCompleted - u.lapsCompleted);
    DOM.gapAheadCar.textContent = `P${ahead.position} (#${ahead.number})`;
    DOM.gapAheadTime.textContent = `+${(gap * BASE_LAP_TIME).toFixed(1)}s`;
  } else {
    DOM.gapAheadCar.textContent = 'LEADER';
    DOM.gapAheadTime.textContent = '-';
  }
  
  if (userIdx < state.cars.length - 1) {
    const behind = state.cars[userIdx + 1];
    const gap = (u.progress - behind.progress) + (u.lapsCompleted - behind.lapsCompleted);
    DOM.gapBehindCar.textContent = `P${behind.position} (#${behind.number})`;
    DOM.gapBehindTime.textContent = `-${(gap * BASE_LAP_TIME).toFixed(1)}s`;
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
  
  // Strategy Recommendation
  const rec = getRecommendation(u.compound, u.tyreAge, state.lap, u.fuelPct);
  DOM.engCall.textContent = rec.state;
  if (rec.state.includes('PIT')) {
    DOM.engCall.className = 'engineer-call pit';
  } else {
    DOM.engCall.className = 'engineer-call';
  }
  
  DOM.engOptLap.textContent = `LAP ${rec.optimalLap}`;
  if (DOM.engOptTyre) DOM.engOptTyre.textContent = rec.nextCompound;
  if (DOM.engOptFuel) DOM.engOptFuel.textContent = `+${rec.fuelNeeded.toFixed(1)}kg`;
  
  // Undercut battle
  if (userIdx > 0) {
    const ahead = state.cars[userIdx - 1];
    const gap = (ahead.progress - u.progress) * BASE_LAP_TIME;
    if (gap < 2.0 && ahead.tyreAge > 10) {
      DOM.battleTarget.classList.add('hidden');
      DOM.battleStats.classList.remove('hidden');
      
      const undercut = evaluate_undercut(ahead.compound, ahead.tyreAge, gap, state.totalLaps - state.lap, u.compound);
      DOM.battleUndercut.textContent = `${undercut.net_gain > 0 ? '+' : ''}${Number(undercut.net_gain).toFixed(1)}s`;
      DOM.battleUndercut.className = undercut.net_gain > 0 ? 'val positive' : 'val negative';
      
      DOM.battleRec.textContent = undercut.recommended ? 'ATTACK / PIT' : 'HOLD';
      DOM.battleRec.style.color = undercut.recommended ? 'var(--red)' : 'var(--text-primary)';
    } else {
      DOM.battleTarget.classList.remove('hidden');
      DOM.battleStats.classList.add('hidden');
    }
  } else {
    DOM.battleTarget.textContent = 'NO ACTIVE TARGET';
    DOM.battleTarget.classList.remove('hidden');
    DOM.battleStats.classList.add('hidden');
  }

  // Broadcast state to any listeners (e.g. Research Pages)
  stateListeners.forEach(cb => cb(state));
}

function populateWhyModal() {
  const u = state.userCar;
  const rec = getRecommendation(u.compound, u.tyreAge, state.lap);
  
  const html = `
    <ol>
      <li><strong>Estimated Tyre-Induced Pace Loss:</strong> Your ${u.compound} tyres are losing +${getDegradationDelta(u.compound, u.tyreAge).toFixed(2)}s per lap compared to fresh rubber.</li>
      <li><strong>Remaining Distance:</strong> ${state.totalLaps - state.lap} laps remaining to calculate over.</li>
      <li><strong>Pit Loss:</strong> A stop under current ${state.raceEvent} conditions costs approx ${state.raceEvent === 'GREEN' ? '28s' : '18s'}.</li>
      <li><strong>Counterfactual Simulation:</strong> The deterministic O(N²) search identifies Lap ${rec.optimalLap} as minimizing total race time under current assumptions.</li>
      <li><strong>Strategic Environment:</strong> Traffic and SC/VSC multipliers are ${state.raceEvent !== 'GREEN' ? 'active, heavily biasing towards pitting' : 'inactive'}.</li>
    </ol>
    <p><strong>Conclusion:</strong> Under the current simulated conditions, pitting on <strong>Lap ${rec.optimalLap}</strong> (${rec.state}) minimizes projected remaining race time.</p>
  `;
  document.getElementById('why-content').innerHTML = html;
}

function finishRace() {
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
  const rec = getRecommendation(u.compound, u.tyreAge, state.lap);
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
