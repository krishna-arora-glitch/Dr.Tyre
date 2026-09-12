/**
 * attendeePanel.js — Audience Race Viewer & Multi-Car Head-to-Head Comparison
 * 
 * A read-only dashboard that consumes the existing simulation state.
 * Supports up to 2 cars simultaneously in a 50/50 side-by-side comparison.
 * Simulation track is positioned below the comparison and prominently highlights both cars.
 */

import { onSimulationUpdate, getSimulationState, raceConfig } from '../simulation/simulation.js';
import { getDegradationDelta, getRecommendation, COMPOUND_THERMAL_WINDOWS } from '../simulation/strategy.js';
import { CIRCUITS } from '../simulation/circuits.js';
import { computeTyreHealth } from '../simulation/tyreHealth.js';

// ── State ──────────────────────────────────────────────────────────
let initialized = false;
let selectedCarIds = ['USER']; // Holds 1 or 2 car IDs (max 2)
let lastSimState = null;
let currentTrackId = null;
let miniTrackPath = null;
let miniTrackLength = 0;
let miniCarElements = new Map(); // carId -> { dot, halo, tagGroup, tagRect, tagText }
let miniSvgContainer = null;
let selectorPopulated = false;

// ── DOM Cache ──────────────────────────────────────────────────────
const DOM = {};

function cacheDOM() {
  DOM.carSelect = document.getElementById('attendee-car-select');
  DOM.selectedChips = document.getElementById('attendee-selected-chips');
  DOM.statusBanner = document.getElementById('attendee-status-banner');
  DOM.carsContainer = document.getElementById('attendee-cars-container');
  DOM.miniTrack = document.getElementById('attendee-mini-track');
  DOM.trackName = document.getElementById('attendee-track-name');
  DOM.trackLegend = document.getElementById('attendee-track-legend');
}

// ── Helper: Compound Color ─────────────────────────────────────────
function getCompoundColor(compound) {
  if (compound === 'SOFT') return '#FF3333';
  if (compound === 'MEDIUM') return '#FFD700';
  if (compound === 'HARD') return '#FFFFFF';
  return '#00E5FF';
}

function formatLapTime(seconds) {
  if (!seconds || seconds <= 0) return '--:--.---';
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${m}:${s}`;
}

// ── Selection Management ───────────────────────────────────────────
function toggleCarSelection(carId) {
  if (!carId) return;

  if (selectedCarIds.includes(carId)) {
    // Deselect if already selected
    selectedCarIds = selectedCarIds.filter(id => id !== carId);
  } else {
    // Add to selection (max 2)
    if (selectedCarIds.length < 2) {
      selectedCarIds.push(carId);
    } else {
      // If 2 already selected, replace the 2nd car
      selectedCarIds[1] = carId;
    }
  }

  onSelectionChanged();
}

function deselectCar(carId) {
  selectedCarIds = selectedCarIds.filter(id => id !== carId);
  onSelectionChanged();
}

function onSelectionChanged() {
  const cars = lastSimState?.cars || [];
  renderChips(cars);
  updateDropdownSelection(cars);
  rebuildCarCards(cars);
  updateTrackLegend(cars);
  if (lastSimState) {
    updateAttendeePanel(lastSimState);
  }
}

// ── Render Active Car Chips in Header ──────────────────────────────
function renderChips(cars) {
  if (!DOM.selectedChips) return;
  DOM.selectedChips.innerHTML = '';

  selectedCarIds.forEach((id, index) => {
    const car = cars.find(c => c.id === id) || {
      id,
      number: id === 'USER' ? 11 : '?',
      team: id === 'USER' ? 'Red Bull' : 'Team',
      color: id === 'USER' ? '#00e5ff' : '#888',
      isUser: id === 'USER'
    };

    const chip = document.createElement('div');
    chip.className = 'attendee-chip';
    chip.style.borderLeft = `4px solid ${car.color || '#000'}`;
    chip.innerHTML = `
      <span style="width:10px; height:10px; border-radius:50%; background:${car.color || '#888'}; border:1px solid #000; flex-shrink:0;"></span>
      <span>${car.isUser ? `★ #${car.number} YOU` : `#${car.number} ${car.team}`}</span>
      <span style="font-size:0.65rem; color:var(--text-muted); font-weight:800; background:var(--color-soft-mist); padding:1px 5px; border-radius:3px;">CAR ${index + 1}</span>
      <button class="attendee-chip-btn" title="Deselect car" data-car-id="${car.id}">✕</button>
    `;

    chip.querySelector('.attendee-chip-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deselectCar(car.id);
    });

    DOM.selectedChips.appendChild(chip);
  });

  if (selectedCarIds.length === 1) {
    const hint = document.createElement('span');
    hint.style.fontSize = '0.75rem';
    hint.style.color = 'var(--text-muted)';
    hint.style.fontWeight = '600';
    hint.textContent = '+ Pick 2nd car to compare';
    DOM.selectedChips.appendChild(hint);
  }
}

// ── Populate & Update Car Selector Dropdown ────────────────────────
function populateCarSelector(cars) {
  if (!DOM.carSelect) return;

  DOM.carSelect.innerHTML = '';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = selectedCarIds.length === 0 
    ? 'Select car to view...'
    : selectedCarIds.length === 1 
      ? '+ Select 2nd car to compare (1/2)...' 
      : 'Switch compared car (2/2 selected)...';
  defaultOpt.selected = true;
  DOM.carSelect.appendChild(defaultOpt);

  cars.forEach(car => {
    const opt = document.createElement('option');
    opt.value = car.id;
    const isSelected = selectedCarIds.includes(car.id);
    const prefix = isSelected ? '✓ ' : '';
    const label = car.isUser
      ? `${prefix}★ #${car.number} — YOU (${car.team})`
      : `${prefix}#${car.number} — ${car.team}`;
    opt.textContent = isSelected ? `${label} (SELECTED)` : label;
    DOM.carSelect.appendChild(opt);
  });

  selectorPopulated = true;
}

function updateDropdownSelection(cars) {
  if (!DOM.carSelect) return;
  // Re-run population to reflect updated checkmarks
  populateCarSelector(cars);
}

// ── Rebuild Car Cards (1 Car vs 2 Equal 50/50 Columns) ─────────────
let lastBuiltCarKey = '';

function rebuildCarCards(cars) {
  if (!DOM.carsContainer) return;

  const currentCarKey = selectedCarIds.join('|');
  if (currentCarKey === lastBuiltCarKey) return;
  lastBuiltCarKey = currentCarKey;

  DOM.carsContainer.innerHTML = '';

  // Case 0: No cars selected
  if (selectedCarIds.length === 0) {
    DOM.carsContainer.style.display = 'block';
    DOM.carsContainer.innerHTML = `
      <div class="glass-panel" style="padding:40px 20px; text-align:center; border:2px solid var(--color-carbon); border-radius:var(--radius-md); background:var(--color-paper-white);">
        <div style="font-size:2.4rem; margin-bottom:8px;">🏎️💨</div>
        <h3 style="font-size:1.15rem; font-weight:800; color:var(--color-carbon); margin-bottom:6px;">NO CAR SELECTED</h3>
        <p style="font-size:0.82rem; color:var(--text-secondary); max-width:440px; margin:0 auto;">
          Choose 1 or 2 cars from the dropdown selector above to monitor real-time telemetry and compare race performance side-by-side.
        </p>
      </div>
    `;
    return;
  }

  // Case 1 & 2: 1 or 2 Cars
  if (selectedCarIds.length === 1) {
    DOM.carsContainer.style.display = 'grid';
    DOM.carsContainer.style.gridTemplateColumns = '1fr';
    DOM.carsContainer.style.gap = '20px';
  } else {
    // TWO EQUAL PARTS (50% / 50%)
    DOM.carsContainer.style.display = 'grid';
    DOM.carsContainer.style.gridTemplateColumns = '1fr 1fr';
    DOM.carsContainer.style.gap = '20px';
  }

  selectedCarIds.forEach((id, index) => {
    const car = cars.find(c => c.id === id) || {
      id,
      number: id === 'USER' ? 11 : '?',
      team: id === 'USER' ? 'Red Bull' : 'Team',
      color: id === 'USER' ? '#00e5ff' : '#888',
      isUser: id === 'USER'
    };

    const col = document.createElement('div');
    col.className = 'attendee-car-column';
    col.id = `attendee-col-${index}`;
    col.style.display = 'flex';
    col.style.flexDirection = 'column';
    col.style.gap = '16px';

    col.innerHTML = `
      <!-- Driver Identity Card -->
      <div class="glass-panel attendee-identity-card" style="padding:16px 20px; display:flex; align-items:center; justify-content:space-between; gap:16px; border-left:6px solid ${car.color || '#00e5ff'};">
        <div style="display:flex; align-items:center; gap:14px;">
          <div id="attendee-team-color-${index}" style="width:46px; height:46px; border-radius:50%; background:${car.color || '#888'}; flex-shrink:0; border:2px solid var(--color-carbon); box-shadow:0 0 16px rgba(0,0,0,0.15);"></div>
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span id="attendee-driver-name-${index}" style="font-size:1.4rem; font-weight:800; color:var(--color-carbon); letter-spacing:0.5px;">
                ${car.isUser ? `#${car.number} — YOU` : `#${car.number}`}
              </span>
              <span style="font-size:0.68rem; font-weight:800; background:var(--color-soft-mist); border:1px solid var(--color-carbon); color:var(--color-carbon); padding:2px 8px; border-radius:12px;">
                CAR ${index + 1}
              </span>
            </div>
            <div id="attendee-team-name-${index}" style="font-size:0.82rem; color:var(--text-secondary); font-weight:600;">${car.team}</div>
          </div>
        </div>
        <button class="attendee-deselect-btn" data-car-id="${car.id}" title="Deselect this car">
          ✕ Deselect
        </button>
      </div>

      <!-- Big 3 Stat Cards -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <!-- Position -->
        <div class="glass-panel attendee-stat-card" style="padding:14px;">
          <div class="attendee-stat-label">POSITION</div>
          <div id="attendee-position-${index}" class="attendee-stat-value" style="color:var(--color-carbon); font-size:1.8rem;">P—</div>
        </div>
        <!-- Lap -->
        <div class="glass-panel attendee-stat-card" style="padding:14px;">
          <div class="attendee-stat-label">LAP</div>
          <div id="attendee-lap-${index}" class="attendee-stat-value" style="font-size:1.8rem;">— / —</div>
        </div>
        <!-- Speed -->
        <div class="glass-panel attendee-stat-card" style="grid-column: span 2; padding:16px 20px;">
          <div class="attendee-stat-label">SPEED</div>
          <div style="display:flex; align-items:baseline; gap:8px;">
            <div id="attendee-speed-${index}" class="attendee-stat-value attendee-speed-value" style="font-size:3.2rem; color:var(--green); font-weight:900;">0</div>
            <span style="font-size:1rem; color:var(--text-muted); font-weight:700;">km/h</span>
          </div>
        </div>
      </div>

      <!-- Tyre + Fuel Row -->
      <div style="display:grid; grid-template-columns:1fr 1fr 1.1fr 1fr; gap:12px;">
        <!-- Compound -->
        <div class="glass-panel attendee-stat-card" style="padding:12px;">
          <div class="attendee-stat-label">COMPOUND</div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
            <div id="attendee-compound-dot-${index}" style="width:12px; height:12px; border-radius:50%; background:#888; border:1px solid #000; flex-shrink:0;"></div>
            <div id="attendee-compound-${index}" class="attendee-stat-value" style="font-size:1.1rem;">—</div>
          </div>
        </div>
        <!-- Tyre Age -->
        <div class="glass-panel attendee-stat-card" style="padding:12px;">
          <div class="attendee-stat-label">TYRE AGE</div>
          <div style="display:flex; align-items:baseline; gap:4px; margin-top:2px;">
            <div id="attendee-tyre-age-${index}" class="attendee-stat-value" style="font-size:1.4rem;">0</div>
            <span style="font-size:0.7rem; color:var(--text-muted); font-weight:700;">LAPS</span>
          </div>
        </div>
        <!-- Tyre Temp -->
        <div class="glass-panel attendee-stat-card" style="padding:12px;">
          <div class="attendee-stat-label">TYRE TEMP</div>
          <div style="display:flex; align-items:baseline; gap:4px; margin-top:2px;">
            <div id="attendee-tyre-temp-${index}" class="attendee-stat-value" style="font-size:1.2rem; color:var(--green);">—°C</div>
            <span id="attendee-thermal-status-${index}" style="font-size:0.65rem; font-weight:800; color:var(--text-muted);">OPT</span>
          </div>
        </div>
        <!-- Fuel -->
        <div class="glass-panel attendee-stat-card" style="padding:12px;">
          <div class="attendee-stat-label">FUEL</div>
          <div id="attendee-fuel-pct-${index}" class="attendee-stat-value" style="font-size:1.4rem; margin-top:2px;">—</div>
        </div>
      </div>

      <!-- Pace Loss + Pit Stops + Gear -->
      <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
        <div class="glass-panel attendee-stat-card" style="padding:12px;">
          <div class="attendee-stat-label">PACE LOSS</div>
          <div id="attendee-degradation-${index}" class="attendee-stat-value" style="font-size:1.15rem; color:#ff3333;">+0.00s</div>
        </div>
        <div class="glass-panel attendee-stat-card" style="padding:12px;">
          <div class="attendee-stat-label">PIT STOPS</div>
          <div id="attendee-pit-stops-${index}" class="attendee-stat-value" style="font-size:1.4rem;">0</div>
        </div>
        <div class="glass-panel attendee-stat-card" style="padding:12px;">
          <div class="attendee-stat-label">GEAR</div>
          <div id="attendee-gear-${index}" class="attendee-stat-value" style="font-size:1.4rem; color:var(--color-carbon);">—</div>
        </div>
      </div>

      <!-- 5-Indicator Tyre Health & Puncture Risk Panel -->
      <div class="glass-panel attendee-health-card" style="padding:14px 18px; border-left:5px solid var(--color-carbon);">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:0.68rem; background:rgba(0,0,0,0.06); color:var(--color-carbon); padding:2px 8px; border-radius:4px; font-weight:800; border:1px solid rgba(0,0,0,0.15);">DIAGNOSTICS</span>
            <span style="font-size:0.75rem; font-weight:900; color:var(--color-carbon); letter-spacing:0.5px;">TYRE HEALTH</span>
          </div>
          <span id="attendee-puncture-badge-${index}" style="font-size:0.68rem; font-weight:800; padding:2px 8px; border-radius:4px; border:1px solid #16a34a; background:rgba(22,163,74,0.12); color:#16a34a;">
            8% LOW RISK
          </span>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px;">
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">GRIP LEVEL</div>
            <div id="attendee-grip-${index}" style="font-size:1.15rem; font-weight:900; color:var(--green); font-family:var(--font-mono);">100%</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">TREAD REMAINING</div>
            <div id="attendee-tread-${index}" style="font-size:1.15rem; font-weight:900; color:var(--color-carbon); font-family:var(--font-mono);">100%</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">DEG RATE</div>
            <div id="attendee-deg-rate-${index}" style="font-size:0.95rem; font-weight:800; color:var(--color-carbon); font-family:var(--font-mono); margin-top:2px;">+0.050 s/L</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">TYRE ENERGY</div>
            <div id="attendee-tyre-energy-${index}" style="font-size:0.95rem; font-weight:900; color:var(--color-carbon); font-family:var(--font-mono); margin-top:2px;">30 LAPS</div>
          </div>
        </div>
      </div>

      <!-- 4-Corner Individual Tyre Matrix & Dynamic Rate -->
      <div class="glass-panel" style="padding:10px 14px; border-left:5px solid #0284c7;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span style="font-size:0.68rem; font-weight:800; color:var(--color-carbon);">4-CORNER TYRE HEALTH</span>
          <span id="attendee-dyn-trend-${index}" style="font-size:0.62rem; font-weight:800; padding:1px 5px; border-radius:3px; background:#dcfce7; color:#166534;">STABLE</span>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:6px; font-family:var(--font-mono); font-size:0.65rem; text-align:center;">
          <div style="background:rgba(0,0,0,0.03); padding:4px; border-radius:3px; border:1px solid rgba(0,0,0,0.1);">
            <div style="font-weight:700; color:var(--text-muted);">FL</div>
            <strong id="attendee-fl-${index}">--</strong>
          </div>
          <div style="background:rgba(0,0,0,0.03); padding:4px; border-radius:3px; border:1px solid rgba(0,0,0,0.1);">
            <div style="font-weight:700; color:var(--text-muted);">FR</div>
            <strong id="attendee-fr-${index}">--</strong>
          </div>
          <div style="background:rgba(0,0,0,0.03); padding:4px; border-radius:3px; border:1px solid rgba(0,0,0,0.1);">
            <div style="font-weight:700; color:var(--text-muted);">RL</div>
            <strong id="attendee-rl-${index}">--</strong>
          </div>
          <div style="background:rgba(0,0,0,0.03); padding:4px; border-radius:3px; border:1px solid rgba(0,0,0,0.1);">
            <div style="font-weight:700; color:var(--text-muted);">RR</div>
            <strong id="attendee-rr-${index}">--</strong>
          </div>
        </div>
      </div>

      <!-- Pit Strategy Recommendation -->
      <div class="glass-panel attendee-strategy-card" style="padding:16px 18px; border-left:5px solid var(--amber);">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
          <span style="font-size:0.68rem; background:rgba(255,193,7,0.2); color:var(--color-carbon); padding:2px 8px; border-radius:4px; font-weight:800; border:1px solid rgba(0,0,0,0.15);">STRATEGY</span>
          <span style="font-size:0.75rem; font-weight:800; color:var(--text-secondary); letter-spacing:0.5px;">PIT RECOMMENDATION</span>
        </div>
        <div style="display:grid; grid-template-columns:1.2fr 1fr 1fr; gap:10px;">
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">STATUS</div>
            <div id="attendee-pit-state-${index}" style="font-size:1rem; font-weight:900; color:var(--green);">STAY OUT</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">OPTIMAL PIT</div>
            <div id="attendee-pit-lap-${index}" style="font-size:1rem; font-weight:800; color:var(--color-carbon);">—</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">TARGET TYRE</div>
            <div id="attendee-pit-compound-${index}" style="font-size:1rem; font-weight:800; color:var(--color-carbon);">—</div>
          </div>
        </div>
        <div id="attendee-pit-rec-${index}" style="margin-top:8px; padding-top:6px; border-top:1px dashed rgba(0,0,0,0.15); font-size:0.75rem; color:var(--text-secondary); font-weight:600;">—</div>
      </div>

      <!-- Lap Times & Telemetry Inputs -->
      <div class="glass-panel" style="padding:14px 18px;">
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:10px;">
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">LAST LAP</div>
            <div id="attendee-last-lap-${index}" style="font-size:0.9rem; font-weight:800; color:var(--color-carbon); font-family:var(--font-mono);">--:--.---</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">BEST LAP</div>
            <div id="attendee-best-lap-${index}" style="font-size:0.9rem; font-weight:800; color:var(--green); font-family:var(--font-mono);">--:--.---</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">THROTTLE</div>
            <div id="attendee-throttle-${index}" style="font-size:0.9rem; font-weight:800; color:var(--green); font-family:var(--font-mono);">—</div>
          </div>
          <div>
            <div style="font-size:0.65rem; color:var(--text-muted); margin-bottom:2px; font-weight:700;">BRAKE</div>
            <div id="attendee-brake-${index}" style="font-size:0.9rem; font-weight:800; color:var(--red); font-family:var(--font-mono);">—</div>
          </div>
        </div>
      </div>
    `;

    // Hook up deselect button
    col.querySelector('.attendee-deselect-btn').addEventListener('click', () => {
      deselectCar(car.id);
    });

    DOM.carsContainer.appendChild(col);
  });
}

// ── Update Track Legend ────────────────────────────────────────────
function updateTrackLegend(cars) {
  if (!DOM.trackLegend) return;
  DOM.trackLegend.innerHTML = '';

  selectedCarIds.forEach((id, index) => {
    const car = cars.find(c => c.id === id) || {
      id,
      number: id === 'USER' ? 11 : '?',
      team: id === 'USER' ? 'Red Bull' : 'Team',
      color: id === 'USER' ? '#00e5ff' : '#888',
      isUser: id === 'USER'
    };

    const item = document.createElement('div');
    item.style.display = 'inline-flex';
    item.style.alignItems = 'center';
    item.style.gap = '6px';
    item.innerHTML = `
      <span style="width:12px; height:12px; border-radius:50%; background:${car.color || '#00e5ff'}; border:2px solid #000; box-shadow:0 0 6px ${car.color || '#00e5ff'};"></span>
      <span style="color:var(--color-carbon); font-weight:800;">
        ${car.isUser ? `★ #${car.number} YOU` : `#${car.number} ${car.team}`} (Car ${index + 1})
      </span>
    `;
    DOM.trackLegend.appendChild(item);
  });

  // Other Cars legend marker
  const otherItem = document.createElement('div');
  otherItem.style.display = 'inline-flex';
  otherItem.style.alignItems = 'center';
  otherItem.style.gap = '6px';
  otherItem.innerHTML = `
    <span style="width:9px; height:9px; border-radius:50%; background:#888; opacity:0.4; border:1px solid #000;"></span>
    <span style="color:var(--text-muted); font-weight:600;">Other Cars</span>
  `;
  DOM.trackLegend.appendChild(otherItem);
}

// ── Build Enlarged Mini Track SVG ──────────────────────────────────
function buildMiniTrack(cars) {
  if (!DOM.miniTrack) return;

  const trackId = raceConfig.trackId || 'singapore';
  const circuit = CIRCUITS[trackId];
  if (!circuit) return;

  currentTrackId = trackId;
  if (DOM.trackName) {
    DOM.trackName.textContent = circuit.fullName || circuit.name.toUpperCase();
  }

  DOM.miniTrack.innerHTML = '';
  miniCarElements.clear();

  miniSvgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  miniSvgContainer.setAttribute('viewBox', '0 0 800 600');
  miniSvgContainer.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  miniSvgContainer.style.width = '100%';
  miniSvgContainer.style.height = '100%';

  // Defs for Glow Filter
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = `
    <filter id="attendeeGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  `;
  miniSvgContainer.appendChild(defs);

  // Background road (thick clean dark tarmac)
  const road = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  road.setAttribute('d', circuit.circuit.centerline);
  road.setAttribute('fill', 'none');
  road.setAttribute('stroke', 'rgba(0, 0, 0, 0.12)');
  road.setAttribute('stroke-width', '30');
  road.setAttribute('stroke-linecap', 'round');
  road.setAttribute('stroke-linejoin', 'round');
  miniSvgContainer.appendChild(road);

  // Track centerline
  miniTrackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  miniTrackPath.setAttribute('d', circuit.circuit.centerline);
  miniTrackPath.setAttribute('fill', 'none');
  miniTrackPath.setAttribute('stroke', 'var(--color-carbon)');
  miniTrackPath.setAttribute('stroke-width', '2.5');
  miniTrackPath.setAttribute('stroke-dasharray', '12 8');
  miniTrackPath.setAttribute('opacity', '0.45');
  miniSvgContainer.appendChild(miniTrackPath);

  DOM.miniTrack.appendChild(miniSvgContainer);

  // Measure path length
  miniTrackLength = miniTrackPath.getTotalLength();

  // Create SVGs for all cars: Halo ring, Dot, and Floating Number Badge
  cars.forEach(car => {
    // 1. Halo circle for highlighted cars
    const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    halo.setAttribute('class', 'attendee-halo');
    halo.setAttribute('r', '18');
    halo.setAttribute('fill', 'none');
    halo.setAttribute('stroke', car.color || 'var(--cyan)');
    halo.setAttribute('stroke-width', '2.5');
    halo.style.display = 'none';
    miniSvgContainer.appendChild(halo);

    // 2. Car dot
    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('r', '5');
    dot.setAttribute('fill', car.color || '#888');
    dot.setAttribute('stroke', 'rgba(0, 0, 0, 0.4)');
    dot.setAttribute('stroke-width', '1');
    dot.setAttribute('opacity', '0.35');
    miniSvgContainer.appendChild(dot);

    // 3. Floating label badge tag
    const tagGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    tagGroup.style.display = 'none';
    tagGroup.style.pointerEvents = 'none';

    const tagRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    tagRect.setAttribute('x', '-22');
    tagRect.setAttribute('y', '-12');
    tagRect.setAttribute('width', '44');
    tagRect.setAttribute('height', '18');
    tagRect.setAttribute('rx', '4');
    tagRect.setAttribute('ry', '4');
    tagRect.setAttribute('fill', 'var(--color-carbon)');
    tagRect.setAttribute('stroke', '#ffffff');
    tagRect.setAttribute('stroke-width', '1.5');
    tagGroup.appendChild(tagRect);

    const tagText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    tagText.setAttribute('x', '0');
    tagText.setAttribute('y', '1');
    tagText.setAttribute('text-anchor', 'middle');
    tagText.setAttribute('font-family', 'monospace');
    tagText.setAttribute('font-size', '10');
    tagText.setAttribute('font-weight', 'bold');
    tagText.setAttribute('fill', '#ffffff');
    tagText.textContent = car.isUser ? `★#${car.number}` : `#${car.number}`;
    tagGroup.appendChild(tagText);

    miniSvgContainer.appendChild(tagGroup);

    miniCarElements.set(car.id, { dot, halo, tagGroup, tagRect, tagText });
  });
}

// ── Update Panel (called on every simulation tick) ─────────────────
function updateAttendeePanel(simState) {
  if (!simState || !simState.cars || simState.cars.length === 0) return;
  lastSimState = simState;

  // Track changed or initial load
  if (currentTrackId !== raceConfig.trackId || !miniSvgContainer) {
    buildMiniTrack(simState.cars);
  }

  // Populate selector once
  if (!selectorPopulated) {
    populateCarSelector(simState.cars);
    renderChips(simState.cars);
    rebuildCarCards(simState.cars);
    updateTrackLegend(simState.cars);
  }

  // ── Status Banner ──
  if (DOM.statusBanner) {
    if (!simState.active && simState.lap <= 1) {
      DOM.statusBanner.textContent = 'GRID READY';
      DOM.statusBanner.className = 'attendee-status-pill attendee-status-grid';
    } else if (simState.active) {
      const eventText = simState.raceEvent === 'SC' ? '🟡 SAFETY CAR'
        : simState.raceEvent === 'VSC' ? '🟡 VIRTUAL SAFETY CAR'
        : '🟢 RACING';
      DOM.statusBanner.textContent = eventText;
      DOM.statusBanner.className = 'attendee-status-pill attendee-status-live';
    } else {
      DOM.statusBanner.textContent = 'RACE FINISHED';
      DOM.statusBanner.className = 'attendee-status-pill attendee-status-finished';
    }
  }

  const totalLaps = simState.totalLaps || 61;

  // Update telemetry for each selected car (Slot 0 and Slot 1)
  selectedCarIds.forEach((id, index) => {
    const car = simState.cars.find(c => c.id === id);
    if (!car) return;

    // Driver & Team
    const nameEl = document.getElementById(`attendee-driver-name-${index}`);
    if (nameEl) nameEl.textContent = car.isUser ? `#${car.number} — YOU` : `#${car.number}`;
    const teamEl = document.getElementById(`attendee-team-name-${index}`);
    if (teamEl) teamEl.textContent = car.team;
    const colorEl = document.getElementById(`attendee-team-color-${index}`);
    if (colorEl) colorEl.style.background = car.color || '#888';

    // Position & Lap
    const posEl = document.getElementById(`attendee-position-${index}`);
    if (posEl) posEl.textContent = `P${car.position}`;
    const lapEl = document.getElementById(`attendee-lap-${index}`);
    if (lapEl) lapEl.textContent = `${Math.min(car.currentLap || 1, totalLaps)} / ${totalLaps}`;

    // Speed
    const speedEl = document.getElementById(`attendee-speed-${index}`);
    if (speedEl) speedEl.textContent = `${Math.round(car.speed || 0)}`;

    // Compound & Tyre Age
    const compEl = document.getElementById(`attendee-compound-${index}`);
    if (compEl) compEl.textContent = car.compound || '—';
    const compDotEl = document.getElementById(`attendee-compound-dot-${index}`);
    if (compDotEl) compDotEl.style.background = getCompoundColor(car.compound);
    const tyreAgeEl = document.getElementById(`attendee-tyre-age-${index}`);
    if (tyreAgeEl) tyreAgeEl.textContent = `${Math.max(0, car.tyreAge || 0)}`;

    // Tyre Temp & Thermal Status
    const tempEl = document.getElementById(`attendee-tyre-temp-${index}`);
    const statusEl = document.getElementById(`attendee-thermal-status-${index}`);
    const tyreTemp = car.tyreTemp !== undefined ? car.tyreTemp : 100;
    if (tempEl) tempEl.textContent = `${Math.round(tyreTemp)}°C`;
    if (statusEl) {
      const win = COMPOUND_THERMAL_WINDOWS[car.compound] || COMPOUND_THERMAL_WINDOWS.MEDIUM;
      if (tyreTemp > win.blister || tyreTemp > win.opt + 10) {
        statusEl.textContent = 'HOT 🔥';
        statusEl.style.color = 'var(--red)';
        if (tempEl) tempEl.style.color = 'var(--red)';
      } else if (tyreTemp > win.opt + 4) {
        statusEl.textContent = 'WARM';
        statusEl.style.color = 'var(--amber)';
        if (tempEl) tempEl.style.color = 'var(--amber)';
      } else {
        statusEl.textContent = 'OPT';
        statusEl.style.color = 'var(--green)';
        if (tempEl) tempEl.style.color = 'var(--green)';
      }
    }

    // Fuel
    const fuelEl = document.getElementById(`attendee-fuel-pct-${index}`);
    if (fuelEl) fuelEl.textContent = `${Math.max(0, car.fuelPct || 0).toFixed(0)}%`;

    // Pace Loss / Degradation
    const degEl = document.getElementById(`attendee-degradation-${index}`);
    if (degEl) {
      const degDelta = getDegradationDelta(car.compound, car.tyreAge, car.setup, car.thermalState);
      degEl.textContent = `+${degDelta.toFixed(2)}s`;
    }

    // Pit stops & Gear
    const pitStopsEl = document.getElementById(`attendee-pit-stops-${index}`);
    if (pitStopsEl) pitStopsEl.textContent = car.pitStops || 0;
    const gearEl = document.getElementById(`attendee-gear-${index}`);
    if (gearEl) gearEl.textContent = car.gear !== undefined ? car.gear : '—';

    // ── 5-Indicator Tyre Health & Puncture Risk Engine (SELECTED ATTENDEE CAR) ──
    const health = car.tyreHealth || computeTyreHealth(car, lastSimState?.modelData);
    if (health) {
      const gripEl = document.getElementById(`attendee-grip-${index}`);
      if (gripEl) {
        gripEl.textContent = `${health.gripLevel}%`;
        gripEl.style.color = health.gripLevel > 70 ? 'var(--green)' : (health.gripLevel > 40 ? 'var(--amber)' : 'var(--red)');
      }
      const treadEl = document.getElementById(`attendee-tread-${index}`);
      if (treadEl) {
        treadEl.textContent = `${health.treadRemaining}%`;
        treadEl.style.color = health.treadRemaining > 50 ? 'var(--color-carbon)' : (health.treadRemaining > 20 ? 'var(--amber)' : 'var(--red)');
      }
      const degRateEl = document.getElementById(`attendee-deg-rate-${index}`);
      if (degRateEl) {
        degRateEl.textContent = health.degRateFormatted;
        degRateEl.title = `Prediction Confidence: ${health.degConfidenceScore}% (${health.degConfidenceLevel})`;
      }
      const energyEl = document.getElementById(`attendee-tyre-energy-${index}`);
      if (energyEl) energyEl.textContent = health.tyreEnergyText;
      const punctBadge = document.getElementById(`attendee-puncture-badge-${index}`);
      if (punctBadge) {
        punctBadge.textContent = `${health.punctureRiskScore}% ${health.punctureRiskLevel} RISK`;
        punctBadge.style.color = health.punctureRiskColor;
        punctBadge.style.background = health.punctureRiskBg;
        punctBadge.style.borderColor = health.punctureRiskColor;
      }
    }

    // ── 4-Corner Individual Tyre Matrix & Dynamic Degradation (SELECTED CAR) ──
    const ind = car.individualTyres;
    if (ind) {
      const flEl = document.getElementById(`attendee-fl-${index}`);
      if (flEl) {
        flEl.textContent = `${ind.FL.health}%`;
        flEl.style.color = ind.FL.health > 70 ? 'var(--green)' : (ind.FL.health > 45 ? 'var(--amber)' : 'var(--red)');
      }
      const frEl = document.getElementById(`attendee-fr-${index}`);
      if (frEl) {
        frEl.textContent = `${ind.FR.health}%`;
        frEl.style.color = ind.FR.health > 70 ? 'var(--green)' : (ind.FR.health > 45 ? 'var(--amber)' : 'var(--red)');
      }
      const rlEl = document.getElementById(`attendee-rl-${index}`);
      if (rlEl) {
        rlEl.textContent = `${ind.RL.health}%`;
        rlEl.style.color = ind.RL.health > 70 ? 'var(--green)' : (ind.RL.health > 45 ? 'var(--amber)' : 'var(--red)');
      }
      const rrEl = document.getElementById(`attendee-rr-${index}`);
      if (rrEl) {
        rrEl.textContent = `${ind.RR.health}%`;
        rrEl.style.color = ind.RR.health > 70 ? 'var(--green)' : (ind.RR.health > 45 ? 'var(--amber)' : 'var(--red)');
      }
    }
    const dyn = car.dynamicDegradation;
    if (dyn) {
      const trendEl = document.getElementById(`attendee-dyn-trend-${index}`);
      if (trendEl) {
        trendEl.textContent = `${dyn.trendSymbol} ${dyn.trend}`;
        trendEl.style.color = dyn.trendColor;
      }
    }

    // Pit Strategy Recommendation
    const rec = getRecommendation(car.compound, car.tyreAge, simState.lap, car.fuelPct, car.setup, simState.cars, car.thermalState);
    const pitStateEl = document.getElementById(`attendee-pit-state-${index}`);
    if (pitStateEl) {
      pitStateEl.textContent = rec.state || 'STAY OUT';
      if (rec.state && rec.state.includes('PIT NOW')) {
        pitStateEl.style.color = 'var(--red)';
      } else if (rec.state && (rec.state.includes('CONSIDER') || rec.state.includes('WINDOW'))) {
        pitStateEl.style.color = 'var(--amber)';
      } else {
        pitStateEl.style.color = 'var(--green)';
      }
    }
    const pitLapEl = document.getElementById(`attendee-pit-lap-${index}`);
    if (pitLapEl) pitLapEl.textContent = (rec.optimalLap !== undefined && rec.optimalLap !== 'N/A') ? `LAP ${rec.optimalLap}` : (rec.optimalLap === 'N/A' ? 'N/A' : '—');
    const pitCompEl = document.getElementById(`attendee-pit-compound-${index}`);
    if (pitCompEl) pitCompEl.textContent = rec.nextCompound || '—';
    const pitRecEl = document.getElementById(`attendee-pit-rec-${index}`);
    if (pitRecEl) {
      pitRecEl.textContent = rec.recommendedAction ? `${rec.recommendedAction} (Gain: +${(rec.projectedGain || 0).toFixed(1)}s)` : (rec.reason || '—');
    }

    // Lap Times & Telemetry Inputs
    const lastLapEl = document.getElementById(`attendee-last-lap-${index}`);
    if (lastLapEl) lastLapEl.textContent = formatLapTime(car.lastLapTime);
    const bestLapEl = document.getElementById(`attendee-best-lap-${index}`);
    if (bestLapEl) bestLapEl.textContent = formatLapTime(car.bestLapTime);
    const throttleEl = document.getElementById(`attendee-throttle-${index}`);
    if (throttleEl) throttleEl.textContent = car.throttle !== undefined ? `${Math.round(car.throttle)}%` : '—';
    const brakeEl = document.getElementById(`attendee-brake-${index}`);
    if (brakeEl) brakeEl.textContent = car.brake !== undefined ? `${Math.round(car.brake)}%` : '—';
  });

  // ── Update Mini Track Car Dots ──
  updateMiniTrack(simState.cars);
}

// ── Update Mini Track Coordinates & Highlights ─────────────────────
function updateMiniTrack(cars) {
  if (!miniTrackPath || !miniTrackLength) return;

  cars.forEach(car => {
    const el = miniCarElements.get(car.id);
    if (!el) return;

    const { dot, halo, tagGroup } = el;

    // Pit lane handling
    if (car.pitState) {
      dot.setAttribute('opacity', '0.12');
      halo.style.display = 'none';
      tagGroup.style.display = 'none';
      return;
    }

    const t = ((car.progress % 1) + 1) % 1;
    const pt = miniTrackPath.getPointAtLength(t * miniTrackLength);

    dot.setAttribute('cx', pt.x);
    dot.setAttribute('cy', pt.y);

    const isSelected = selectedCarIds.includes(car.id);

    if (isSelected) {
      // Highlighted Selected Car (Enlarged, Glowing, Halo Ring, Floating Tag)
      dot.setAttribute('r', '12');
      dot.setAttribute('opacity', '1');
      dot.setAttribute('stroke', '#FFFFFF');
      dot.setAttribute('stroke-width', '3');
      dot.setAttribute('filter', 'url(#attendeeGlow)');

      halo.setAttribute('cx', pt.x);
      halo.setAttribute('cy', pt.y);
      halo.style.display = 'block';

      tagGroup.setAttribute('transform', `translate(${pt.x}, ${pt.y - 18})`);
      tagGroup.style.display = 'block';

      // Move highlighted elements to top of SVG render stack
      miniSvgContainer.appendChild(halo);
      miniSvgContainer.appendChild(dot);
      miniSvgContainer.appendChild(tagGroup);
    } else {
      // Unselected Car (Subtle, smaller, muted)
      dot.setAttribute('r', '5');
      dot.setAttribute('opacity', '0.35');
      dot.setAttribute('stroke', 'rgba(0, 0, 0, 0.4)');
      dot.setAttribute('stroke-width', '1');
      dot.removeAttribute('filter');

      halo.style.display = 'none';
      tagGroup.style.display = 'none';
    }
  });
}

// ── Initialize ─────────────────────────────────────────────────────
export function initAttendeePanel() {
  if (initialized) return;
  initialized = true;
  cacheDOM();

  if (DOM.carSelect) {
    DOM.carSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        toggleCarSelection(val);
      }
    });
  }

  // Register for simulation updates
  onSimulationUpdate((simState) => {
    updateAttendeePanel(simState);
  });
}

// ── Reset ──────────────────────────────────────────────────────────
export function resetAttendeePanel() {
  selectorPopulated = false;
  miniCarElements.clear();
  selectedCarIds = ['USER'];
  lastBuiltCarKey = '';
}
