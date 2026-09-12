import { onSimulationUpdate, raceConfig, getSimulationState } from '../simulation/simulation.js';
import { getDegradationDelta, getRecommendation, evaluate_undercut, getDegradationUncertainty } from '../simulation/strategy.js';
import { CIRCUITS } from '../simulation/circuits.js';
import { evaluateOpponentIntent } from '../simulation/opponentIntent.js';
import { computeTyreFingerprint } from '../simulation/tyreFingerprint.js';
import { generateGrid } from '../simulation/competitors.js';

let initialized = false;
let currentModelData = null;
let lastSimState = null;
let selectedCarNumber = null;
let lastTableUpdateTime = 0;

// Expose globally immediately so inline onclick/onpointerdown handlers work without waiting
if (typeof window !== 'undefined') {
  window.openCompetitorPrescription = openCompetitorPrescription;
  window.openCompetitorModal = openCompetitorPrescription;
  window.closeCompetitorModal = closeCompetitorModal;
}

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
    // Throttle table updates to at most once every 350ms so click/pointer events are never cancelled
    const now = performance.now();
    if (now - lastTableUpdateTime >= 350) {
      lastTableUpdateTime = now;
      updateCompetitorsTable(simState);
    }
    if (selectedCarNumber !== null) {
      updateCompetitorModalIfOpen(simState);
    }
  });

  // Initial render if simulation state already exists
  const existingState = lastSimState || (typeof getSimulationState === 'function' ? getSimulationState() : null) || window.getSimulationState?.();
  updateCompetitorsTable(existingState);
}

/**
 * Sets up persistent click delegation for the competitor table rows
 * and modal close triggers (close button, backdrop, Escape key).
 */
function setupModalEvents() {
  const modal = document.getElementById('competitor-strategy-modal');
  const closeBtn = document.getElementById('csm-btn-close');

  if (closeBtn) {
    ['click', 'pointerdown'].forEach(evt => {
      closeBtn.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeCompetitorModal();
      });
    });
  }

  if (modal) {
    ['click', 'pointerdown'].forEach(evt => {
      modal.addEventListener(evt, (e) => {
        if (e.target === modal) {
          closeCompetitorModal();
        }
      });
    });
  }

  // Close modal via Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      closeCompetitorModal();
    }
  });

  // Event delegation on both 'pointerdown' AND 'click'.
  // 'pointerdown' fires the instant the button is pressed, with 0ms delay,
  // making it completely immune to DOM re-renders.
  ['pointerdown', 'click'].forEach(eventType => {
    document.addEventListener(eventType, (e) => {
      const inspectBtn = e.target.closest('.csm-inspect-btn');
      if (inspectBtn) {
        e.preventDefault();
        e.stopPropagation();
        const row = inspectBtn.closest('.competitor-row');
        const carId = row?.dataset?.carNumber || row?.getAttribute('data-car-number') || row?.getAttribute('data-car-id');
        if (carId !== null && carId !== undefined) {
          console.log(`[Competitor Prescription] Inspect button triggered (${eventType}) for #${carId}`);
          openCompetitorPrescription(carId);
        }
        return;
      }

      // If clicked anywhere on competitor row
      const row = e.target.closest('.competitor-row');
      if (row) {
        const carId = row.dataset.carNumber || row.getAttribute('data-car-number') || row.getAttribute('data-car-id');
        if (carId !== null && carId !== undefined) {
          console.log(`[Competitor Prescription] Row triggered (${eventType}) for #${carId}`);
          openCompetitorPrescription(carId);
        }
      }
    });
  });
}

/**
 * Closes the competitor prescription modal and clears selection.
 */
export function closeCompetitorModal() {
  const modal = document.getElementById('competitor-strategy-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.setProperty('display', 'none', 'important');
    modal.style.setProperty('visibility', 'hidden', 'important');
    modal.style.setProperty('opacity', '0', 'important');
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

  const circuit = CIRCUITS[raceConfig?.trackId];
  const baseLapTime = circuit ? circuit.baseLapTimeSec : 94.0;

  // Fallback to initial grid if simulation not started yet
  if (!simState || !simState.cars || simState.cars.length === 0) {
    const cars = generateGrid(8, baseLapTime);
    simState = { lap: 1, totalLaps: circuit?.raceLaps || 61, cars, userCar: cars.find(c => c.isUser) || cars[0] };
  }

  const userCar = simState.cars.find(c => c.isUser);
  const totalLaps = simState.totalLaps || 61;
  const currentLap = simState.lap || 1;

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
    const trStyle = isUser ? 'background: rgba(0, 229, 255, 0.08); border-left: 3px solid var(--cyan); cursor: pointer;' : 'cursor: pointer;';

    const setupStr = car.setup ? `<div style="font-size:0.7em;color:var(--text-muted);">${car.setup.downforceLevel} DF / ${car.setup.balance} BAL</div>` : '';

    const optLapDisplay = (!rec.optimalLap || rec.optimalLap === 'N/A') 
      ? 'N/A' 
      : (String(rec.optimalLap).toUpperCase().includes('FINISH') ? 'RACE FINISH' : (String(rec.optimalLap).startsWith('Lap') ? rec.optimalLap : `Lap ${rec.optimalLap}`));

    html += `
      <tr class="${trClass}" data-car-number="${car.number}" data-car-id="${car.id || car.number}" style="${trStyle}" onpointerdown="window.openCompetitorPrescription('${car.number}')" onclick="window.openCompetitorPrescription('${car.number}')" title="Click to view detailed strategy prescription for Car ${car.number}">
        <td><strong style="${isUser ? 'color: var(--cyan);' : ''}">P${car.position}</strong></td>
        <td>
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div>
              <strong style="${isUser ? 'color: var(--cyan);' : ''}">${isUser ? 'YOU (#11)' : (car.driverName ? `${car.driverName} (#${car.number})` : `AI (#${car.number})`)}</strong>
              ${setupStr}
            </div>
            <button type="button" class="csm-inspect-btn" onpointerdown="event.stopPropagation(); window.openCompetitorPrescription('${car.number}')" onclick="event.stopPropagation(); window.openCompetitorPrescription('${car.number}')" style="cursor: pointer; font-family: var(--font-mono); font-size: 0.68rem; color: #1e40af; background: #dbeafe; padding: 3px 8px; border-radius: 4px; font-weight: 800; border: 1.5px solid #3b82f6; box-shadow: 0 1px 2px rgba(0,0,0,0.12); display: inline-flex; align-items: center; gap: 4px; text-transform: uppercase;">
              <span>INSPECT</span> <span style="font-size: 0.8rem; font-weight: 900;">↗</span>
            </button>
          </div>
        </td>
        <td><span class="data-label" style="background: ${getCompoundColor(car.compound)}20; color: ${getCompoundColor(car.compound)}; border-color: ${getCompoundColor(car.compound)}50;">${car.compound}</span></td>
        <td>${Math.max(1, car.tyreAge)}${isCliff ? ' ⚠️ (CLIFF)' : ''}</td>
        <td style="color: #dc2626; font-weight: 700;">+${paceLoss.toFixed(2)}s <span style="font-size:0.8em;color:var(--text-muted);font-weight:normal;">&plusmn;${uncertainty.toFixed(2)}</span></td>
        <td ${recClass}>${rec.state} (${optLapDisplay})</td>
        <td class="${battleClass}">${battleText}</td>
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

  let state = lastSimState || (typeof getSimulationState === 'function' ? getSimulationState() : null) || window.getSimulationState?.();
  if (!state || !state.cars || state.cars.length === 0) {
    const circuit = CIRCUITS[raceConfig?.trackId];
    const baseLapTime = circuit ? circuit.baseLapTimeSec : 94.0;
    const cars = generateGrid(8, baseLapTime);
    state = { lap: 1, totalLaps: circuit?.raceLaps || 61, cars, userCar: cars.find(c => c.isUser) || cars[0] };
  }

  // Find exact competitor car by number or ID
  const car = state.cars.find(c => Number(c.number) === carNumber || c.id === carId || String(c.number) === String(carId));
  if (!car) {
    console.warn(`[Competitor Prescription] Car with identifier #${carId} not found in grid.`);
    return;
  }

  selectedCarNumber = car.number;
  try {
    renderCompetitorStrategyModal(car, state);
  } catch (err) {
    console.error('[Competitor Prescription] Error in renderCompetitorStrategyModal:', err);
    // Force show modal
    const modal = document.getElementById('competitor-strategy-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.setProperty('display', 'flex', 'important');
      modal.style.setProperty('visibility', 'visible', 'important');
      modal.style.setProperty('opacity', '1', 'important');
      modal.style.setProperty('pointer-events', 'auto', 'important');
      modal.style.setProperty('z-index', '999999', 'important');
    }
  }
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
  if (confEl) {
    const score = oppReport.prescription.confidenceScore || 75;
    const level = oppReport.prescription.confidenceLevel || (score >= 80 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW');
    confEl.textContent = `${score}% ${level}`;
  }

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

  // Opponent Intent Prediction Confidence
  const intentConfEl = document.getElementById('csm-intent-conf');
  if (intentConfEl) {
    const iScore = oppReport.intent.confidenceScore || oppReport.prescription.confidenceScore || 75;
    const iLevel = oppReport.intent.confidenceLevel || (iScore >= 80 ? 'HIGH' : iScore >= 60 ? 'MEDIUM' : 'LOW');
    intentConfEl.textContent = `${iScore}% ${iLevel}`;
    intentConfEl.className = iLevel === 'HIGH' ? 'conf-high' : (iLevel === 'MEDIUM' ? 'conf-medium' : 'conf-low');
  }

  // Intent Reasoning with evidence explanation
  const reasoningEl = document.getElementById('csm-intent-reasoning');
  if (reasoningEl) {
    const baseReason = oppReport.intent.intentReasoning;
    const confReason = oppReport.intent.confidenceReason ? ` Evidence: ${oppReport.intent.confidenceReason}` : '';
    reasoningEl.textContent = `${baseReason}${confReason}`;
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
  modal.style.setProperty('display', 'flex', 'important');
  modal.style.setProperty('visibility', 'visible', 'important');
  modal.style.setProperty('opacity', '1', 'important');
  modal.style.setProperty('pointer-events', 'auto', 'important');
  modal.style.setProperty('z-index', '999999', 'important');
  console.log('[Competitor Prescription] Modal opened: true for Car #' + car.number);
}

function renderMiniBar(id, val) {
  const el = document.getElementById(id);
  const valEl = document.getElementById(`${id}-val`);
  const safeVal = Math.min(100, Math.max(0, Number(val) || 0));
  if (el) {
    el.style.height = `${safeVal}%`;
    el.style.width = '100%';
  }
  if (valEl) valEl.textContent = Math.round(safeVal);
}

function getCompoundColor(compound) {
  if (compound === 'SOFT') return '#dc2626';
  if (compound === 'MEDIUM') return '#d97706';
  if (compound === 'HARD') return '#1e293b';
  return '#0284c7';
}
