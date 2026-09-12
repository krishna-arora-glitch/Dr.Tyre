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
import {
  initSubNav, initTyreIntelligence, initGhostBaseline,
  initCompare, initInvestigate, initValidation,
  initProvenance, initReport, updateResearchWithSimulationState
} from './research/research.js';
import { initStoryMode } from './research/story.js';
import { initSetup } from './setup/setup.js';
import { initCompetitorsPage } from './competitors/competitorsPage.js';
import { initLapChart, updateLapChart } from './simulation/lap-chart.js';
import { initExtraCharts, updateExtraCharts } from './simulation/extra-charts.js';
import { getSimulationState } from './simulation/simulation.js';
import { activePrior, setActivePrior, registerOnPriorChange } from './fuel-prior-state.js';
import { initLogisticsLab } from './logistics/logistics.js';
import { initAttendeePanel } from './attendee/attendeePanel.js';

let modelData = null;
let telemetryData = null;
let researchInitialized = false;
let storyInitialized = false;

// Global Chart.js configuration: black axes, ticks, tick labels
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#000000';
  Chart.defaults.borderColor = '#000000';
  if (Chart.defaults.scale) {
    if (!Chart.defaults.scale.border) Chart.defaults.scale.border = {};
    Chart.defaults.scale.border.color = '#000000';
    Chart.defaults.scale.border.width = 2;
    Chart.defaults.scale.border.display = true;
    if (!Chart.defaults.scale.ticks) Chart.defaults.scale.ticks = {};
    Chart.defaults.scale.ticks.color = '#000000';
    if (!Chart.defaults.scale.grid) Chart.defaults.scale.grid = {};
    Chart.defaults.scale.grid.color = 'rgba(0, 0, 0, 0.06)';
    Chart.defaults.scale.grid.tickColor = '#000000';
  }
}

// ── Fuel-Prior Sensitivity State ───────────────────────────────

/**
 * Resolve the active prior's data from the sensitivity_grid
 * into the flat data.compounds / data.charts / data.track_evolution
 * shape that all existing UI consumers expect.
 */
function resolveActivePrior(data) {
  if (!data?.sensitivity_grid) return;
  const grid = data.sensitivity_grid[activePrior];
  if (!grid) return;

  // If grid.compounds is empty (telemetry_stress had no fits), build from models.baseline
  let compounds = grid.compounds;
  if (!compounds || Object.keys(compounds).length === 0) {
    if (grid.models?.baseline) {
      compounds = {};
      for (const [comp, model] of Object.entries(grid.models.baseline)) {
        compounds[comp] = {
          base_pace: model.base_pace,
          deg_linear: model.deg_linear || model.deg_per_lap_linear,
          deg_quadratic: model.deg_quadratic,
          r2_quadratic: model.r2_quadratic,
          r2_linear: model.r2_linear,
          residual_std: model.residual_std,
          stress_coef: model.stress_coef,
          cliff_lap: model.cliff_lap,
          max_age_fitted: model.max_age_fitted,
          n_laps: model.n_laps,
          fresh_pace: model.fresh_pace,
          color: model.color || { 'SOFT': '#ff3333', 'MEDIUM': '#ffd700', 'HARD': '#000000' }[comp] || '#000000',
          curve_ages: model.curve_ages,
          curve_deltas: model.curve_deltas,
          curve_predicted: model.curve_predicted,
          scatter_ages: model.scatter_ages,
          scatter_deltas: model.scatter_deltas,
        };
      }
    }
  }

  data.compounds = compounds;
  data.charts = grid.charts;
  data.track_evolution = grid.track_evolution;
  data.models = grid.models;
  data.traffic = grid.traffic_extended;
  data.fuel = data.fuel || {}; // The backend puts fuel at the root metadata, or we can use the slider value
}

/**
 * Called when the fuel-prior slider value changes.
 * Updates the active prior, resolves the grid, and re-renders
 * all affected research panels.
 */
function handlePriorChange(newPrior) {
  if (!modelData) return;
  resolveActivePrior(modelData);

  // Force re-render of all research panels with new prior
  researchInitialized = false;
  initResearchPages(modelData);

  // Re-render standalone pages if currently visible
  initValidation(modelData);
  populateModelInfo(modelData);

  // Update competitors page
  initCompetitorsPage(modelData);

  // Re-render story mode with new data
  storyInitialized = false;
  initStoryMode(modelData);
}

// Register callback so research.js can trigger prior changes
registerOnPriorChange(handlePriorChange);

// Global car filter state for charts (Set of car numbers)
export let activeCarFilters = new Set();

// ── Load Model Data ────────────────────────────────────────────
async function loadModelData(trackId = 'singapore') {
  const statusEl = document.getElementById('data-status');
  const statusText = statusEl.querySelector('.status-text');

  try {
    statusEl.classList.remove('ready', 'error');
    statusText.textContent = 'LOADING...';

    const response = await fetch(`/model_output_${trackId.toLowerCase()}.json?t=` + Date.now());
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
      const date = new Date(modelData.metadata.last_run_timestamp);
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


    // Update raceConfig to match the track that was generated
    if (modelData.race_info && modelData.race_info.trackId) {
      setRaceConfig(modelData.race_info.trackId, raceConfig.condition || 'DRY');
    }

    // Resolve default prior into flat shape for backward compat
    resolveActivePrior(modelData);

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
    tab.addEventListener('click', async () => {
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
      } else if (targetTab === 'simulation') {
        if (!modelData) {
          modelData = await loadModelData(selectedTrackId || 'singapore');
        }
        if (modelData) {
          initSimulation(modelData, modelData.telemetry);
          initResearchPages(modelData);
          initLapChart();
          initExtraCharts();
        }
      } else if (targetTab === 'competitors') {
        if (!modelData) {
          modelData = await loadModelData(selectedTrackId || 'singapore');
        }
        if (modelData) {
          initCompetitorsPage(modelData);
        }
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
      } else if (targetTab === 'logistics') {
        if (!document.getElementById('chart-logistics').classList.contains('initialized')) {
          initLogisticsLab();
          document.getElementById('chart-logistics').classList.add('initialized');
        }
      } else if (targetTab === 'attendee') {
        initAttendeePanel();
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
    btn.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${car.color}; border:1px solid #000; margin-right:5px; vertical-align:middle;"></span>${car.number}`;
    btn.style.padding = '4px 10px';
    btn.style.borderRadius = '4px';
    btn.style.cursor = 'pointer';
    btn.style.fontWeight = 'bold';
    btn.style.fontFamily = 'var(--font-mono)';
    btn.style.color = '#000000';
    btn.style.border = isActive ? '2px solid #000000' : '1px solid rgba(0, 0, 0, 0.3)';
    btn.style.backgroundColor = isActive ? '#e2e8f0' : '#ffffff';

    btn.addEventListener('click', () => {
      if (activeCarFilters.has(car.number)) {
        activeCarFilters.delete(car.number);
        btn.classList.remove('active');
        btn.style.backgroundColor = '#ffffff';
        btn.style.border = '1px solid rgba(0, 0, 0, 0.3)';
        btn.style.color = '#000000';
      } else {
        activeCarFilters.add(car.number);
        btn.classList.add('active');
        btn.style.backgroundColor = '#e2e8f0';
        btn.style.border = '2px solid #000000';
        btn.style.color = '#000000';
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
        <div class="metric-card-label">FUEL ASSUMPTION (PRIOR)</div>
        <div class="metric-card-value" style="font-size:1.2rem;">${activePrior} s/kg</div>
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
          <path d="${circuit.circuit.centerline}" fill="none" stroke="currentColor" stroke-width="4"></path>
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
  document.getElementById('btn-confirm-track').addEventListener('click', async () => {
    if (!selectedTrackId) return;

    // Set global config
    setRaceConfig(selectedTrackId, selectedCondition);

    // Load model data for this track dynamically
    modelData = await loadModelData(selectedTrackId);

    // Update pre-race setup UI in simulation tab
    const c = CIRCUITS[selectedTrackId];
    document.getElementById('pre-race-circuit').textContent = c.name.toUpperCase();
    document.getElementById('pre-race-laps').textContent = c.raceLaps + ' LAPS';
    document.getElementById('pre-race-condition').textContent = selectedCondition;

    // Update global header badge
    const badge = document.getElementById('race-badge');
    if (badge) badge.textContent = `2024 ${c.name.toUpperCase()} GP`;

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

  // Pre-select default track (singapore) and preload modelData immediately
  selectTrack('singapore');
  loadModelData('singapore').then(data => {
    modelData = data;
    if (modelData) {
      initSimulation(modelData, modelData.telemetry);
      initCompetitorsPage(modelData);
      initResearchPages(modelData);
      initLapChart();
      initExtraCharts();
    }
  });

  // Force Track Setup as the landing page
  document.getElementById('tab-track-select').click();

  // Wire simulation state to research pages and lap chart
  onSimulationUpdate((simState) => {
    populateCarFilters(simState);
    if (modelData) {
      updateResearchWithSimulationState(simState, modelData);
    }
    updateLapChart(simState);
    updateExtraCharts(simState);

    // #7: Update race progress bar
    const timeline = document.getElementById('rc-timeline');
    if (timeline && simState.totalLaps) {
      const pct = Math.min(100, (simState.lap / simState.totalLaps) * 100);
      timeline.innerHTML = `
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--cyan),rgba(0,229,255,0.3));border-radius:inherit;transition:width 0.5s ease;"></div>
        <span style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-family:var(--font-mono);font-size:0.75rem;color:var(--text-primary);letter-spacing:1px;">LAP ${Math.min(simState.lap, simState.totalLaps)} / ${simState.totalLaps}</span>
      `;
    }
  });
}

document.addEventListener('DOMContentLoaded', bootstrap);
