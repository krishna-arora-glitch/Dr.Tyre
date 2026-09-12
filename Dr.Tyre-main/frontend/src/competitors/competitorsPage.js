import { onSimulationUpdate, raceConfig, getSimulationState } from '../simulation/simulation.js';
import { getDegradationDelta, getRecommendation, evaluate_undercut, getDegradationUncertainty } from '../simulation/strategy.js';
import { CIRCUITS } from '../simulation/circuits.js';
import { evaluateOpponentIntent } from '../simulation/opponentIntent.js';
import { computeTyreFingerprint } from '../simulation/tyreFingerprint.js';

let initialized = false;
let currentModelData = null;
let lastSimState = null;
let selectedCarNumber = null;

/**
 * Initializes the Competitors Comparison page and sets up persistent
 * event listeners for competitor row clicks and modal interactions.
 */
export function initCompetitorsPage(modelData) {
  currentModelData = modelData || currentModelData || window.modelData;
  if (initialized) {
    // If re-called, trigger a render if state is present
    const existingState = lastSimState || (typeof getSimulationState === 'function' ? getSimulationState() : null) || window.getSimulationState?.();
    if (existingState) updateCompetitorsTable(existingState);
    return;
  }
  initialized = true;

  // Setup persistent global event delegation for modal controls & row clicks
  setupModalEvents();

  // Listen to simulation updates
  onSimulationUpdate((simState) => {
    lastSimState = simState;
    updateCompetitorsTable(simState);
    if (selectedCarNumber !== null) {
      updateCompetitorModalIfOpen(simState);
    }
  });

  // Initial render if simulation state already exists
  const existingState = lastSimState || (typeof getSimulationState === 'function' ? getSimulationState() : null) || window.getSimulationState?.();
  if (existingState && existingState.cars && existingState.cars.length > 0) {
    updateCompetitorsTable(existingState);
  }
}

/**
 * Sets up persistent click delegation for the competitor table rows
 * and modal close triggers (close button, backdrop, Escape key).
 */
function setupModalEvents() {
  const modal = document.getElementById('competitor-strategy-modal');
  const closeBtn = document.getElementById('csm-btn-close');

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      closeCompetitorModal();
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeCompetitorModal();
      }
    });
  }

  // Close modal via Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      closeCompetitorModal();
    }
  });

  // Event delegation on the document for competitor row clicks.
  // This guarantees clicks are caught even if table elements are refreshed mid-click.
  document.addEventListener('click', (e) => {
    const row = e.target.closest('.competitor-row');
    if (!row) return;

    // Check that row is inside the competitor table
    const tableBody = row.closest('#competitors-table-body');
    if (!tableBody) return;

    const carId = row.dataset.carNumber || row.getAttribute('data-car-number') || row.getAttribute('data-car-id');
    if (carId !== null && carId !== undefined) {
      console.log(`[Competitor Prescription] Row clicked: #${carId}`);
      openCompetitorPrescription(carId);
    }
  });
}

/**
 * Closes the competitor prescription modal and clears selection.
 */
export function closeCompetitorModal() {
  const modal = document.getElementById('competitor-strategy-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
  selectedCarNumber = null;

  // Refresh table highlights
  const existingState = lastSimState || (typeof getSimulationState === 'function' ? getSimulationState() : null) || window.getSimulationState?.();
  if (existingState) {
    updateCompetitorsTable(existingState);
  }
}

/**
 * Updates the competitor overview table based on the current simulation state.
 */
function updateCompetitorsTable(simState) {
  const tbody = document.getElementById('competitors-table-body');
  if (!tbody) return;

  if (!simState || !simState.cars || simState.cars.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: var(--text-muted);">Waiting for grid telemetry...</td></tr>';
    return;
  }

  const userCar = simState.cars.find(c => c.isUser);
  const totalLaps = simState.totalLaps || 61;
  const currentLap = simState.lap || 1;
  const circuit = CIRCUITS[raceConfig?.trackId];
  const baseLapTime = circuit ? circuit.baseLapTimeSec : 94.0;

  let html = '';
  const sortedCars = [...simState.cars].sort((a, b) => (a.position || 0) - (b.position || 0));

  sortedCars.forEach((car) => {
    const isUser = car.isUser;
    
    // Calculate Degradation Pace Loss
    const paceLoss = getDegradationDelta(car.compound, car.tyreAge, car.setup, car.thermalState);
    const uncertainty = getDegradationUncertainty(car.compound, car.tyreAge, car.setup);
    const cliffLap = currentModelData?.compounds?.[car.compound]?.cliff_lap || window.modelData?.compounds?.[car.compound]?.cliff_lap || 999;
    const isCliff = car.tyreAge >= cliffLap;
    
    // Recommendation
    const rec = getRecommendation(car.compound, car.tyreAge, currentLap, car.fuelPct, car.setup, null, car.thermalState);
    
    // Undercut / Overtake viability
    let battleText = '-';
    let battleClass = '';
    
    if (!isUser && userCar) {
      const gapToUser = (car.progress - userCar.progress) * baseLapTime + (car.lapsCompleted - userCar.lapsCompleted) * baseLapTime;
      
      if (gapToUser > 0 && gapToUser < 4.0) {
        const undercut = evaluate_undercut(car.compound, car.tyreAge, gapToUser, totalLaps - currentLap, userCar.compound, car.setup, userCar.setup, car.baseLapTime, userCar.baseLapTime);
        if (undercut.works) {
          battleText = `UNDERCUT (+${Number(undercut.net_gain_seconds).toFixed(1)}s)`;
          battleClass = 'positive';
        } else if (paceLoss > 3.0) {
           battleText = 'VULNERABLE';
           battleClass = 'positive';
        } else {
          battleText = 'HOLD';
        }
      } else if (gapToUser < 0 && gapToUser > -4.0) {
        if (paceLoss < getDegradationDelta(userCar.compound, userCar.tyreAge, userCar.setup)) {
            battleText = 'THREAT (Faster)';
            battleClass = 'negative';
        } else {
            battleText = 'DEFEND';
        }
      }
    }

    let recClass = '';
    if (rec.state.includes('PIT')) {
      recClass = 'style="color: var(--red); font-weight: bold;"';
    }

    const isSelected = (selectedCarNumber !== null && Number(car.number) === Number(selectedCarNumber));
    const trClass = `competitor-row ${isSelected ? 'selected-row' : ''}`;
    const trStyle = isUser ? 'background: rgba(0, 229, 255, 0.08); border-left: 3px solid var(--cyan);' : '';

    const setupStr = car.setup ? `<div style="font-size:0.7em;color:var(--text-muted);pointer-events:none;">${car.setup.downforceLevel} DF / ${car.setup.balance} BAL</div>` : '';

    const optLapDisplay = (!rec.optimalLap || rec.optimalLap === 'N/A') 
      ? 'N/A' 
      : (String(rec.optimalLap).toUpperCase().includes('FINISH') ? 'RACE FINISH' : (String(rec.optimalLap).startsWith('Lap') ? rec.optimalLap : `Lap ${rec.optimalLap}`));

    html += `
      <tr class="${trClass}" data-car-number="${car.number}" data-car-id="${car.id || car.number}" style="${trStyle}" title="Click to view detailed strategy prescription for Car ${car.number}">
        <td><strong style="${isUser ? 'color: var(--cyan);' : ''}">P${car.position}</strong></td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px; pointer-events: none;">
            <strong>${isUser ? 'YOU (#11)' : (car.driverName ? `${car.driverName} (#${car.number})` : `AI (#${car.number})`)}</strong>
            <span class="csm-inspect-btn" style="font-size: 0.65rem; color: #2563eb; background: #dbeafe; padding: 1px 5px; border-radius: 3px; font-weight: 800; border: 1px solid #93c5fd; pointer-events: none;">INSPECT ↗</span>
          </div>
          ${setupStr}
        </td>
        <td><span class="data-label" style="background: ${getCompoundColor(car.compound)}20; color: ${getCompoundColor(car.compound)}; border-color: ${getCompoundColor(car.compound)}50; pointer-events: none;">${car.compound}</span></td>
        <td style="pointer-events: none;">${Math.max(1, car.tyreAge)}${isCliff ? ' ⚠️ (CLIFF)' : ''}</td>
        <td style="color: #dc2626; font-weight: 700; pointer-events: none;">+${paceLoss.toFixed(2)}s <span style="font-size:0.8em;color:var(--text-muted);font-weight:normal;">&plusmn;${uncertainty.toFixed(2)}</span></td>
        <td ${recClass} style="pointer-events: none;">${rec.state} (${optLapDisplay})</td>
        <td class="${battleClass}" style="pointer-events: none;">${battleText}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Authoritative function to open and calculate the Strategy Prescription for a specific competitor.
 * 
 * @param {string|number} carId - Unique car number or ID
 */
export function openCompetitorPrescription(carId) {
  const carNumber = Number(carId);
  console.log(`[Competitor Prescription] Opening prescription for: #${carNumber}`);

  const state = lastSimState || (typeof getSimulationState === 'function' ? getSimulationState() : null) || window.getSimulationState?.();
  if (!state || !state.cars || state.cars.length === 0) {
    console.warn('[Competitor Prescription] Simulation state has no cars.');
    return;
  }

  // Find exact competitor car by number or ID
  const car = state.cars.find(c => Number(c.number) === carNumber || c.id === carId || String(c.number) === String(carId));
  if (!car) {
    console.warn(`[Competitor Prescription] Car with identifier #${carId} not found in grid.`);
    return;
  }

  selectedCarNumber = car.number;
  renderCompetitorStrategyModal(car, state);
}

// Backwards-compatible alias
export const openCompetitorModal = openCompetitorPrescription;
if (typeof window !== 'undefined') {
  window.openCompetitorPrescription = openCompetitorPrescription;
  window.openCompetitorModal = openCompetitorModal;
}

/**
 * Updates the modal content if it is currently open when a new simulation tick arrives.
 */
function updateCompetitorModalIfOpen(simState) {
  const modal = document.getElementById('competitor-strategy-modal');
  if (!modal || modal.classList.contains('hidden') || modal.style.display === 'none') return;
  if (selectedCarNumber === null) return;

  const car = simState.cars.find(c => Number(c.number) === Number(selectedCarNumber));
  if (car) {
    renderCompetitorStrategyModal(car, simState);
  }
}

/**
 * Calculates that specific competitor's strategy and populates the modal.
 */
function renderCompetitorStrategyModal(car, simState) {
  const modal = document.getElementById('competitor-strategy-modal');
  console.log('[Competitor Prescription] Modal element found:', !!modal);
  if (!modal) return;

  const userCar = simState.cars.find(c => c.isUser);
  const currentLap = simState.lap || 1;
  const totalLaps = simState.totalLaps || 61;
  const modelDataToUse = currentModelData || window.modelData;

  // 1. Recalculate Opponent Intent & Strategy for this specific car
  const oppReport = evaluateOpponentIntent(car, userCar, currentLap, totalLaps, simState.cars, modelDataToUse);
  // 2. Compute tyre fingerprint for this car
  const fpReport = computeTyreFingerprint(car, modelDataToUse);

  console.log(`[Competitor Prescription] Optimal pit lap: ${oppReport.prescription.optimalPitLap}`);

  // Populate Header
  const titleEl = document.getElementById('csm-title');
  if (titleEl) {
    titleEl.textContent = car.isUser
      ? `YOUR CAR (#${car.number}) — STRATEGY PRESCRIPTION`
      : `CAR ${car.number} (${car.driverName || 'AI'}) — STRATEGY PRESCRIPTION`;
  }

  // Populate Telemetry Strip
  const posEl = document.getElementById('csm-pos');
  if (posEl) posEl.textContent = `P${car.position || '--'}`;

  const compoundEl = document.getElementById('csm-compound');
  if (compoundEl) {
    compoundEl.textContent = car.compound;
    compoundEl.style.color = getCompoundColor(car.compound);
    compoundEl.style.borderColor = getCompoundColor(car.compound);
    compoundEl.style.background = `${getCompoundColor(car.compound)}15`;
  }

  const ageEl = document.getElementById('csm-age');
  if (ageEl) ageEl.textContent = `${Math.max(1, car.tyreAge || 0)} LAPS`;

  const degEl = document.getElementById('csm-deg-rate');
  if (degEl) degEl.textContent = `+${oppReport.competitor.degRate.toFixed(3)} s/lap`;

  const tempEl = document.getElementById('csm-temp');
  if (tempEl) tempEl.textContent = `${oppReport.competitor.tyreTemp}°C`;

  // Optimal Pit Lap & Confidence
  const optLapEl = document.getElementById('csm-opt-lap');
  if (optLapEl) {
    const opt = oppReport.prescription.optimalPitLap;
    optLapEl.textContent = (opt >= totalLaps) ? 'RACE FINISH' : `LAP ${opt}`;
  }

  const confEl = document.getElementById('csm-conf');
  if (confEl) confEl.textContent = `${oppReport.prescription.confidenceScore}%`;

  const actionEl = document.getElementById('csm-action');
  if (actionEl) actionEl.textContent = oppReport.prescription.nextBestAction;

  // "Why?" explanation bullets
  const whyContainer = document.getElementById('csm-why-bullets');
  if (whyContainer) {
    whyContainer.innerHTML = oppReport.prescription.whyBullets
      .map(b => `<li style="margin-bottom: 5px; color: var(--color-carbon); font-size: 0.82rem;"><strong>•</strong> ${b}</li>`)
      .join('');
  }

  // Pit Intent Bars
  const p1Bar = document.getElementById('csm-p1-bar');
  const p1Val = document.getElementById('csm-p1-val');
  if (p1Bar && p1Val) {
    p1Bar.style.width = `${oppReport.intent.p1}%`;
    p1Val.textContent = `${oppReport.intent.p1}%`;
  }

  const p2Bar = document.getElementById('csm-p2-bar');
  const p2Val = document.getElementById('csm-p2-val');
  if (p2Bar && p2Val) {
    p2Bar.style.width = `${oppReport.intent.p2}%`;
    p2Val.textContent = `${oppReport.intent.p2}%`;
  }

  const p3Bar = document.getElementById('csm-p3-bar');
  const p3Val = document.getElementById('csm-p3-val');
  if (p3Bar && p3Val) {
    p3Bar.style.width = `${oppReport.intent.p3}%`;
    p3Val.textContent = `${oppReport.intent.p3}%`;
  }

  // Intent Reasoning
  const reasoningEl = document.getElementById('csm-intent-reasoning');
  if (reasoningEl) {
    reasoningEl.textContent = oppReport.intent.intentReasoning;
  }

  // Tactical Response Badge & Reason
  const respBadge = document.getElementById('csm-response-badge');
  if (respBadge) {
    respBadge.textContent = oppReport.tacticalResponse.action;
    respBadge.className = `tactical-badge ${oppReport.tacticalResponse.badgeClass}`;
  }

  const respReason = document.getElementById('csm-response-reason');
  if (respReason) {
    respReason.textContent = oppReport.tacticalResponse.reason;
  }

  // Mini Tyre Fingerprint Bars
  const fp = fpReport.fingerprint;
  renderMiniBar('csm-fp-warmup', fp.warmup);
  renderMiniBar('csm-fp-grip', fp.peakGrip);
  renderMiniBar('csm-fp-thermal', fp.thermalStress);
  renderMiniBar('csm-fp-wear', fp.mechanicalWear);
  renderMiniBar('csm-fp-slide', fp.sliding);
  renderMiniBar('csm-fp-deg', fp.degradation);
  renderMiniBar('csm-fp-rec', fp.recovery);

  // Set modal visible
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.visibility = 'visible';
  modal.style.opacity = '1';
  console.log('[Competitor Prescription] Modal opened: true');
}

function renderMiniBar(id, val) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(`${id}-val`);
  if (el) el.style.width = `${Math.min(100, Math.max(0, val))}%`;
  if (valEl) valEl.textContent = Math.round(val);
}

function getCompoundColor(compound) {
  if (compound === 'SOFT') return '#dc2626';
  if (compound === 'MEDIUM') return '#d97706';
  if (compound === 'HARD') return '#1e293b';
  return '#0284c7';
}
