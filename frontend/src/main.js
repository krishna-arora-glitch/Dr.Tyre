/**
 * main.js — Entry Point & Tab Routing
 * 
 * Loads model_output.json and wires up tab navigation
 * between Race Control, Research, and Analysis pages.
 */

import './style.css';
import { initSimulation, destroySimulation, onSimulationUpdate, setRaceConfig, raceConfig } from './simulation/simulation.js';
import { CIRCUITS } from './simulation/circuits.js';
import { initAnalysis } from './analysis/analysis.js';
import { initSubNav, initTyreIntelligence, initGhostBaseline,
  initCompare, initInvestigate, initValidation,
  initProvenance, initReport, updateResearchWithSimulationState
} from './research/research.js';
import { initStoryMode } from './research/story.js';
import { initSetup } from './setup/setup.js';
import { initCompetitorsPage } from './competitors/competitorsPage.js';
import { initLapChart, updateLapChart } from './simulation/lap-chart.js';
import { initExtraCharts, updateExtraCharts } from './simulation/extra-charts.js';
import { getSimulationState } from './simulation/simulation.js';

let modelData = null;
let researchInitialized = false;
let storyInitialized = false;

// Global car filter state for charts (Set of car numbers)
export let activeCarFilters = new Set();

// ── Load Model Data ────────────────────────────────────────────
async function loadModelData() {
  const statusEl = document.getElementById('data-status');
  const statusText = statusEl.querySelector('.status-text');

  try {
    const response = await fetch('/model_output.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    modelData = await response.json();

    // Update header badge
    const badge = document.getElementById('race-badge');
    if (modelData.race_info?.name) {
      badge.textContent = modelData.race_info.name.toUpperCase();
    }
    
    // Update timestamp
    const timestamp = document.getElementById('last-run-time');
    if (modelData.metadata?.last_run_timestamp) {
      const date = new Date(modelData.metadata.last_run_timestamp + 'Z');
      timestamp.textContent = `Model Run: ${date.toLocaleTimeString()}`;
    }

    // Update status
    statusEl.classList.remove('error');
    if (modelData.race_info?.is_synthetic) {
      statusEl.classList.add('ready', 'synthetic-data');
      statusText.textContent = 'SYNTHETIC FALLBACK';
    } else {
      statusEl.classList.add('ready', 'live-data');
      statusText.textContent = 'LIVE FASTF1 DATA';
    }

    console.log('[TrackShift] Model data loaded:', modelData);
    return modelData;

  } catch (err) {
    console.error('[TrackShift] Failed to load model data:', err);
    statusEl.classList.add('error');
    statusText.textContent = 'DATA ERROR';
    return null;
  }
}

// ── Tab Navigation ─────────────────────────────────────────────
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const pages = document.querySelectorAll('.page');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.id.replace('tab-', '');

      // Update active tab
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      // Update active page
      pages.forEach(p => {
        p.classList.add('hidden');
        p.classList.remove('active');
      });
      const targetPage = document.getElementById(`page-${targetTab}`);
      if (targetPage) {
        targetPage.classList.remove('hidden');
        targetPage.classList.add('active');
      }

      // Initialize views as needed
      if (targetTab === 'car-setup') {
        initSetup();
      } else if (targetTab === 'simulation' && modelData) {
        initSimulation(modelData);
        initResearchPages(modelData);
        initLapChart();
        initExtraCharts();
      } else if (targetTab === 'competitors' && modelData) {
        initCompetitorsPage(modelData);
      } else if (targetTab === 'validation' && modelData) {
        initValidation(modelData);
        populateModelInfo(modelData);
      } else if (targetTab === 'story' && modelData) {
        if (!storyInitialized) {
          initStoryMode(modelData);
          storyInitialized = true;
        }
      } else if (targetTab === 'data' && modelData) {
        initProvenance(modelData);
      } else if (targetTab === 'report' && modelData) {
        initReport(modelData);
      }
    });
  });
}

// ── Initialize All Research Panels ─────────────────────────────
function initResearchPages(data) {
  if (researchInitialized) return;
  researchInitialized = true;

  // Wire sub-navigation
  initSubNav('rc-panel-tire-strategy');
  initRcChartsNav();

  // Initialize all research sub-panels
  initGhostBaseline(data);
  initTyreIntelligence(data);
  initCompare(data);
  initInvestigate(data);
}

function initRcChartsNav() {
  const container = document.getElementById('rc-charts-container');
  if (!container) return;
  const navContainer = container.querySelector('.research-sub-nav');
  if (!navContainer) return;
  
  const btns = navContainer.querySelectorAll('.sub-nav-btn');
  const panels = container.querySelectorAll(':scope > .sub-panel');
  
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      panels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.target);
      if (target) target.classList.add('active');
    });
  });
}

// ── Car Filters ────────────────────────────────────────────────
function initCarFilters(data) {
  const bar = document.getElementById('car-filter-bar');
  if (!bar) return;
  
  // Clear except the label
  const label = bar.querySelector('span');
  bar.innerHTML = '';
  if (label) bar.appendChild(label);
  
  // Extract cars from grid if available
  const cars = data?.session?.drivers || []; // fallback
  // Actually we need the 20 cars from the simulation grid. 
  // We can just rely on the race state to populate it once when simulation starts.
}

export function populateCarFilters(simState) {
  const bar = document.getElementById('car-filter-bar');
  if (!bar || bar.dataset.populated === 'true') return;
  
  simState.cars.forEach(car => {
    // Only the user's car is active by default
    const isActive = car.isUser;
    if (isActive) {
      activeCarFilters.add(car.number);
    }
    
    const btn = document.createElement('button');
    btn.className = isActive ? 'car-filter-btn active' : 'car-filter-btn';
    btn.textContent = car.number;
    btn.style.border = `2px solid ${car.color}`;
    btn.style.padding = '4px 12px';
    btn.style.borderRadius = '4px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = 'bold';
    btn.style.fontFamily = 'var(--font-mono)';
    
    if (isActive) {
      btn.style.backgroundColor = car.color;
      btn.style.color = '#fff';
    } else {
      btn.style.backgroundColor = 'transparent';
      btn.style.color = car.color;
    }
    
    btn.addEventListener('click', () => {
      if (activeCarFilters.has(car.number)) {
        activeCarFilters.delete(car.number);
        btn.classList.remove('active');
        btn.style.backgroundColor = 'transparent';
        btn.style.color = car.color;
      } else {
        activeCarFilters.add(car.number);
        btn.classList.add('active');
        btn.style.backgroundColor = car.color;
        btn.style.color = '#fff';
      }
      
      const currentState = getSimulationState();
      updateLapChart(currentState);
      updateExtraCharts(currentState);
    });
    
    bar.appendChild(btn);
  });
  
  bar.dataset.populated = 'true';
}

// ── Populate Model Info (Validation page) ──────────────────────
function populateModelInfo(data) {
  const grid = document.getElementById('model-info-grid');
  if (!grid || !data) return;

  grid.innerHTML = '';

  // Fuel Model
  if (data.fuel) {
    let sourceDetail = `Est. burn rate: ${data.fuel.burn_rate_kg_per_lap} kg/lap`;
    if (data.fuel.fit_result) {
      if (data.fuel.fit_result.source === 'fitted') {
        sourceDetail = `Fitted (Laps: ${data.fuel.fit_result.diagnostics.usable_laps}, Cond: ${data.fuel.fit_result.diagnostics.condition_number})`;
      } else {
        sourceDetail = `Fallback: ${data.fuel.fit_result.reason}`;
      }
    }

    grid.innerHTML += `
      <div class="metric-card">
        <div class="metric-card-label">FUEL SENSITIVITY</div>
        <div class="metric-card-value" style="font-size:1.2rem;">${data.fuel.sensitivity_s_per_kg} s/kg</div>
        <div class="metric-card-sublabel">${sourceDetail}</div>
      </div>`;
  }

  // Track Evolution
  if (data.track_evolution) {
    grid.innerHTML += `
      <div class="metric-card">
        <div class="metric-card-label">TRACK EVOLUTION</div>
        <div class="metric-card-value" style="font-size:1.2rem;">${data.track_evolution.slope_s_per_lap} s/lap</div>
        <div class="metric-card-sublabel">Total: ${data.track_evolution.total_evolution_s}s (${data.track_evolution.direction})</div>
      </div>`;
  }

  // Traffic Filter
  if (data.traffic) {
    grid.innerHTML += `
      <div class="metric-card">
        <div class="metric-card-label">TRAFFIC LAPS EXCLUDED</div>
        <div class="metric-card-value" style="font-size:1.2rem;">${data.traffic.pct_traffic}%</div>
        <div class="metric-card-sublabel">${data.traffic.traffic_laps} / ${data.traffic.total_laps} laps flagged</div>
      </div>`;
  }

  // R-squared
  if (data.compounds?.MEDIUM) {
    grid.innerHTML += `
      <div class="metric-card">
        <div class="metric-card-label">MODEL FIT (R²)</div>
        <div class="metric-card-value" style="font-size:1.2rem;">${data.compounds.MEDIUM.r2_quadratic}</div>
        <div class="metric-card-sublabel">Medium: ResStd ${data.compounds.MEDIUM.residual_std}s</div>
      </div>`;
  }

  // Condition Number
  if (data.fuel?.fit_result?.diagnostics) {
    grid.innerHTML += `
      <div class="metric-card">
        <div class="metric-card-label">CONDITION NUMBER</div>
        <div class="metric-card-value" style="font-size:1.2rem;">${data.fuel.fit_result.diagnostics.condition_number}</div>
        <div class="metric-card-sublabel">${data.fuel.fit_result.diagnostics.condition_number === 'Infinity' ? 'Rank-deficient: fuel not separable' : 'Matrix well-conditioned'}</div>
      </div>`;
  }

  // Model type
  if (data.metadata) {
    grid.innerHTML += `
      <div class="metric-card">
        <div class="metric-card-label">MODEL TYPE</div>
        <div class="metric-card-value" style="font-size:1rem;">${data.metadata.model_type}</div>
        <div class="metric-card-sublabel">Pipeline v${data.metadata.pipeline_version}</div>
      </div>`;
  }
}

// ── Track Selection ──────────────────────────────────────────────
let selectedTrackId = null;
let selectedCondition = 'DRY';

function initTrackSelection() {
  const grid = document.getElementById('circuit-grid');
  if (!grid) return;
  
  grid.innerHTML = '';
  
  // Render cards
  Object.values(CIRCUITS).forEach(circuit => {
    const card = document.createElement('div');
    card.className = 'track-card';
    card.dataset.id = circuit.id;
    
    card.innerHTML = `
      <div class="track-card-preview">
        <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid meet">
          <path d="${circuit.circuit.centerline}"></path>
        </svg>
      </div>
      <div class="track-card-info">
        <h3>${circuit.name.toUpperCase()}</h3>
        <p>${circuit.fullName}</p>
      </div>
      <div class="track-card-stats">
        <div class="track-stat">
          <span>LAPS</span>
          <strong>${circuit.raceLaps}</strong>
        </div>
        <div class="track-stat">
          <span>LENGTH</span>
          <strong>${circuit.lengthKm.toFixed(3)} KM</strong>
        </div>
        <div class="track-stat">
          <span>TYPE</span>
          <strong>${circuit.type}</strong>
        </div>
      </div>
    `;
    
    card.addEventListener('click', () => selectTrack(circuit.id));
    grid.appendChild(card);
  });
  
  // Condition buttons
  const condBtns = document.querySelectorAll('.cond-btn');
  condBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      condBtns.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      selectedCondition = e.target.dataset.cond;
    });
  });
  
  // Confirm button
  document.getElementById('btn-confirm-track').addEventListener('click', () => {
    if (!selectedTrackId) return;
    
    // Set global config
    setRaceConfig(selectedTrackId, selectedCondition);
    
    // Update pre-race setup UI in simulation tab
    const c = CIRCUITS[selectedTrackId];
    document.getElementById('pre-race-circuit').textContent = c.name.toUpperCase();
    document.getElementById('pre-race-laps').textContent = c.raceLaps + ' LAPS';
    document.getElementById('pre-race-condition').textContent = selectedCondition;
    
    // Switch to setup tab
    document.getElementById('tab-car-setup').click();
  });
}

function selectTrack(id) {
  selectedTrackId = id;
  
  // Update UI active states
  document.querySelectorAll('.track-card').forEach(card => {
    if (card.dataset.id === id) card.classList.add('active');
    else card.classList.remove('active');
  });
  
  // Update config panel
  const c = CIRCUITS[id];
  document.getElementById('ts-selected-name').textContent = c.name.toUpperCase();
  document.getElementById('ts-selected-desc').textContent = c.fullName;
  
  const statusEl = document.getElementById('ts-model-status');
  if (c.hasRealModel) {
    statusEl.innerHTML = '<span style="color:var(--green)">REAL FASTF1 CALIBRATION</span>';
  } else {
    statusEl.innerHTML = '<span style="color:var(--amber)">SIMULATION TRANSFER</span>';
  }
  
  document.getElementById('btn-confirm-track').disabled = false;
}

// ── Bootstrap ──────────────────────────────────────────────────
async function bootstrap() {
  initTabs();
  initTrackSelection();

  modelData = await loadModelData();

  if (modelData) {
    // Start simulation in background
    initSimulation(modelData);
    
    // Initialize story mode since it's the landing page
    initStoryMode(modelData);
    storyInitialized = true;

    // Wire simulation state to research pages and lap chart
    onSimulationUpdate((simState) => {
      populateCarFilters(simState);
      updateResearchWithSimulationState(simState, modelData);
      updateLapChart(simState);
      updateExtraCharts(simState);
    });
  }
}

document.addEventListener('DOMContentLoaded', bootstrap);
