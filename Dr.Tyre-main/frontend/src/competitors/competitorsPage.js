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
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        closeCompetitorModal();
      }
    });
  }

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
export function updateCompetitorsTable(simState) {
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

  const sortedCars = [...simState.cars].sort((a, b) => (a.position || 0) - (b.position || 0));

  // Render the top executive Opportunity Radar HUD
  renderOpportunityRadarHUD(sortedCars, userCar, currentLap, totalLaps, baseLapTime);

  const userPaceLoss = userCar 
    ? getDegradationDelta(userCar.compound, userCar.tyreAge, userCar.setup, userCar.thermalState)
    : 0.0;

  let html = '';

  sortedCars.forEach((car) => {
    const isUser = car.isUser;
    
    // Calculate Degradation Pace Loss
    const paceLoss = getDegradationDelta(car.compound, car.tyreAge, car.setup, car.thermalState);
    const uncertainty = getDegradationUncertainty(car.compound, car.tyreAge, car.setup);
    const cliffLap = currentModelData?.compounds?.[car.compound]?.cliff_lap || window.modelData?.compounds?.[car.compound]?.cliff_lap || 999;
    const isCliff = car.tyreAge >= cliffLap;
    
    // Recommendation
    const rec = getRecommendation(car.compound, car.tyreAge, currentLap, car.fuelPct, car.setup, null, car.thermalState);
    
    // ── Opportunity Radar Evaluation per competitor ──
    let oppRadarHTML = '';
    
    if (isUser) {
      const cliffLapUser = currentModelData?.compounds?.[userCar.compound]?.cliff_lap || 28;
      const energyRem = Math.max(0, cliffLapUser - userCar.tyreAge);
      if (energyRem >= 3 && !isCliff) {
        oppRadarHTML = `
          <div style="display:inline-flex; flex-direction:column; gap:2px;">
            <span style="display:inline-flex; align-items:center; gap:6px; font-weight:900; font-size:0.76rem; color:#854d0e; background:#fef3c7; border:1.5px solid #d97706; border-radius:4px; padding:3px 8px; width:fit-content;">
              <span style="width:7px; height:7px; border-radius:50%; background:#d97706; display:inline-block;"></span>
              🟡 EXTEND STINT &bull; +2 pos
            </span>
            <span style="font-size:0.67rem; color:#4b5563; font-family:var(--font-mono); font-weight:600;">Carcass stable; target L${rec.optimalLap || 28}</span>
          </div>
        `;
      } else {
        oppRadarHTML = `
          <div style="display:inline-flex; flex-direction:column; gap:2px;">
            <span style="display:inline-flex; align-items:center; gap:6px; font-weight:900; font-size:0.76rem; color:#1e40af; background:#dbeafe; border:1.5px solid #3b82f6; border-radius:4px; padding:3px 8px; width:fit-content;">
              <span style="width:7px; height:7px; border-radius:50%; background:#3b82f6; display:inline-block;"></span>
              🔵 STINT TARGET &bull; Lap ${rec.optimalLap || 28}
            </span>
            <span style="font-size:0.67rem; color:#4b5563; font-family:var(--font-mono); font-weight:600;">Planned pit window execution</span>
          </div>
        `;
      }
    } else if (userCar) {
      const gapToUser = (car.progress - userCar.progress) * baseLapTime + (car.lapsCompleted - userCar.lapsCompleted) * baseLapTime;
      const isAhead = (car.position < userCar.position) || (gapToUser > 0);
      const isDirectAhead = (car.position === userCar.position - 1);
      const isDirectBehind = (car.position === userCar.position + 1);
      const absGap = Math.abs(gapToUser);

      if (isAhead) {
        const undercut = evaluate_undercut(car.compound, car.tyreAge, absGap, totalLaps - currentLap, userCar.compound, car.setup, userCar.setup, car.baseLapTime, userCar.baseLapTime);
        const paceDiff = paceLoss - userPaceLoss;

        if (isDirectAhead && (absGap <= 2.8 || paceDiff >= 0.10)) {
          // Direct Overtake Candidate
          const prob = Math.round(Math.min(94, Math.max(48, 78 + (paceDiff * 16) - (absGap * 7))));
          oppRadarHTML = `
            <div style="display:inline-flex; flex-direction:column; gap:2px;">
              <span style="display:inline-flex; align-items:center; gap:6px; font-weight:900; font-size:0.76rem; color:#166534; background:#dcfce7; border:1.5px solid #16a34a; border-radius:4px; padding:3px 8px; width:fit-content;">
                <span style="width:7px; height:7px; border-radius:50%; background:#16a34a; display:inline-block;"></span>
                🟢 OVERTAKE P${car.position} &bull; ${prob}%
              </span>
              <span style="font-size:0.67rem; color:#4b5563; font-family:var(--font-mono); font-weight:600;">Gap: +${absGap.toFixed(1)}s (DRS zone active)</span>
            </div>
          `;
        } else if (undercut.works || (absGap <= 3.8 && totalLaps - currentLap >= 4)) {
          // Undercut Opportunity
          const wStart = currentLap + 1;
          const wEnd = Math.min(totalLaps, currentLap + 3);
          const netGain = undercut.works ? `+${Number(undercut.net_gain_seconds).toFixed(1)}s net` : '+1.8s fresh delta';
          oppRadarHTML = `
            <div style="display:inline-flex; flex-direction:column; gap:2px;">
              <span style="display:inline-flex; align-items:center; gap:6px; font-weight:900; font-size:0.76rem; color:#166534; background:#dcfce7; border:1.5px solid #16a34a; border-radius:4px; padding:3px 8px; width:fit-content;">
                <span style="width:7px; height:7px; border-radius:50%; background:#16a34a; display:inline-block;"></span>
                🟢 UNDERCUT P${car.position} &bull; L${wStart}–${wEnd}
              </span>
              <span style="font-size:0.67rem; color:#4b5563; font-family:var(--font-mono); font-weight:600;">Net gain: ${netGain} on out-lap</span>
            </div>
          `;
        } else if (paceLoss > 2.8 || isCliff) {
          // Vulnerable Rival
          oppRadarHTML = `
            <div style="display:inline-flex; flex-direction:column; gap:2px;">
              <span style="display:inline-flex; align-items:center; gap:6px; font-weight:900; font-size:0.76rem; color:#854d0e; background:#fef3c7; border:1.5px solid #d97706; border-radius:4px; padding:3px 8px; width:fit-content;">
                <span style="width:7px; height:7px; border-radius:50%; background:#d97706; display:inline-block;"></span>
                🟡 VULNERABLE (+${paceLoss.toFixed(1)}s loss)
              </span>
              <span style="font-size:0.67rem; color:#4b5563; font-family:var(--font-mono); font-weight:600;">Tyre age: ${car.tyreAge}L (Pace dropping)</span>
            </div>
          `;
        } else {
          oppRadarHTML = `
            <div style="display:inline-flex; align-items:center; gap:6px; font-weight:700; font-size:0.73rem; color:#475569; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; padding:2px 7px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#94a3b8; display:inline-block;"></span>
              <span>TRACKING (+${absGap.toFixed(1)}s)</span>
            </div>
          `;
        }
      } else {
        // Car is behind
        const threatPace = userPaceLoss - paceLoss;

        if (isDirectBehind || absGap <= 2.8) {
          const threatLaps = Math.max(1, Math.min(6, Math.round(absGap / Math.max(0.2, (threatPace > 0 ? threatPace : 0.35)))));
          oppRadarHTML = `
            <div style="display:inline-flex; flex-direction:column; gap:2px;">
              <span style="display:inline-flex; align-items:center; gap:6px; font-weight:900; font-size:0.76rem; color:#991b1b; background:#fee2e2; border:1.5px solid #dc2626; border-radius:4px; padding:3px 8px; width:fit-content;">
                <span style="width:7px; height:7px; border-radius:50%; background:#dc2626; display:inline-block;"></span>
                🔴 DEFEND P${car.position} &bull; In ${threatLaps}L
              </span>
              <span style="font-size:0.67rem; color:#4b5563; font-family:var(--font-mono); font-weight:600;">Rival #${car.number} closing (${absGap.toFixed(1)}s behind)</span>
            </div>
          `;
        } else {
          oppRadarHTML = `
            <div style="display:inline-flex; align-items:center; gap:6px; font-weight:700; font-size:0.73rem; color:#475569; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px; padding:2px 7px;">
              <span style="width:6px; height:6px; border-radius:50%; background:#94a3b8; display:inline-block;"></span>
              <span>CLEAR (-${absGap.toFixed(1)}s)</span>
            </div>
          `;
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
        <td>${oppRadarHTML}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Renders the top executive Opportunity Radar HUD answering "What can we exploit right now?".
 */
function renderOpportunityRadarHUD(sortedCars, userCar, currentLap, totalLaps, baseLapTime) {
  const container = document.getElementById('competitors-opportunity-radar');
  if (!container) return;

  if (!userCar || !sortedCars || sortedCars.length === 0) {
    container.innerHTML = '';
    return;
  }

  const userPaceLoss = getDegradationDelta(userCar.compound, userCar.tyreAge, userCar.setup, userCar.thermalState);
  const userIdx = sortedCars.findIndex(c => c.id === userCar.id);
  const rivalAhead = userIdx > 0 ? sortedCars[userIdx - 1] : null;
  const rivalBehind = (userIdx >= 0 && userIdx < sortedCars.length - 1) ? sortedCars[userIdx + 1] : null;

  // 1. OVERTAKE Card
  let overtakeTitle = '🟢 OVERTAKE P6';
  let overtakeProb = 78;
  let overtakeNote = 'DRS zone active; superior apex traction into Turn 7';
  if (rivalAhead) {
    const gapAhead = Math.abs((rivalAhead.progress - userCar.progress) * baseLapTime + (rivalAhead.lapsCompleted - userCar.lapsCompleted) * baseLapTime);
    const rivalPaceLoss = getDegradationDelta(rivalAhead.compound, rivalAhead.tyreAge, rivalAhead.setup, rivalAhead.thermalState);
    const paceDelta = rivalPaceLoss - userPaceLoss;
    overtakeProb = Math.round(Math.min(94, Math.max(45, 78 + (paceDelta * 16) - (gapAhead * 6))));
    overtakeTitle = `🟢 OVERTAKE P${rivalAhead.position}`;
    overtakeNote = `Gap: +${gapAhead.toFixed(1)}s &bull; ${paceDelta >= 0 ? '+' : ''}${paceDelta.toFixed(2)}s/lap pace advantage`;
  } else {
    overtakeTitle = `🟢 RACE LEADER (P1)`;
    overtakeProb = 96;
    overtakeNote = `Controlling pace in clean air at race lead`;
  }

  // 2. UNDERCUT Card
  let undercutTitle = '🟢 UNDERCUT P5';
  let undercutWindow = `L${Math.min(totalLaps, currentLap + 1)}–${Math.min(totalLaps, currentLap + 2)}`;
  let undercutNote = 'Fresh tyre delta projects +1.8s net track position';
  const undercutTarget = rivalAhead || sortedCars[0];
  if (undercutTarget && undercutTarget !== userCar) {
    const gapToTarget = Math.abs((undercutTarget.progress - userCar.progress) * baseLapTime + (undercutTarget.lapsCompleted - userCar.lapsCompleted) * baseLapTime);
    const undercutEval = evaluate_undercut(undercutTarget.compound, undercutTarget.tyreAge, gapToTarget, totalLaps - currentLap, userCar.compound, undercutTarget.setup, userCar.setup);
    const wStart = currentLap + 1;
    const wEnd = Math.min(totalLaps, currentLap + 2);
    undercutTitle = `🟢 UNDERCUT P${undercutTarget.position}`;
    undercutWindow = `L${wStart}–${wEnd}`;
    undercutNote = undercutEval.works 
      ? `+${Number(undercutEval.net_gain_seconds).toFixed(1)}s projected track position gain on out-lap`
      : `Pit window active; fresh tyre delta saves out-lap position`;
  }

  // 3. EXTEND STINT Card
  const cliffLap = currentModelData?.compounds?.[userCar.compound]?.cliff_lap || 28;
  const lapsToCliff = Math.max(0, cliffLap - userCar.tyreAge);
  const potentialPos = userCar.position > 3 ? '+2 positions' : '+1 position';
  const extendNote = (userCar.thermalState?.tyreTemp <= 104)
    ? `Carcass thermal stable (${Math.round(userCar.thermalState?.tyreTemp || 100)}°C); overcut rivals during pit cycle`
    : `Tyre wear manageable (${lapsToCliff}L to cliff); delay stop for clean rejoin window`;

  // 4. DEFEND Card
  let defendTitle = '🔴 DEFEND P7';
  let defendArrival = '3 laps';
  let defendNote = 'Rival on fresh compound closing; protect apex';
  if (rivalBehind) {
    const gapBehind = Math.abs((userCar.progress - rivalBehind.progress) * baseLapTime + (userCar.lapsCompleted - rivalBehind.lapsCompleted) * baseLapTime);
    const rivalBehindPaceLoss = getDegradationDelta(rivalBehind.compound, rivalBehind.tyreAge, rivalBehind.setup, rivalBehind.thermalState);
    const closingDelta = userPaceLoss - rivalBehindPaceLoss;
    const arrivalLaps = Math.max(1, Math.min(6, Math.round(gapBehind / Math.max(0.2, (closingDelta > 0 ? closingDelta : 0.45)))));
    defendTitle = `🔴 DEFEND P${rivalBehind.position}`;
    defendArrival = `${arrivalLaps} lap${arrivalLaps > 1 ? 's' : ''}`;
    defendNote = `Rival #${rivalBehind.number} closing (${gapBehind.toFixed(1)}s behind); protect apex entry into Sector 2`;
  } else {
    defendTitle = `🔴 DEFEND POSITION`;
    defendArrival = `Clear air`;
    defendNote = `No immediate pressure behind; optimize stint pace`;
  }

  container.innerHTML = `
    <div style="background: #ffffff; border: 2px solid #000000; border-radius: 8px; padding: 14px 18px; box-shadow: 0 4px 0 #000000;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #000000; padding-bottom: 8px; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
        <div>
          <div style="font-size: 0.95rem; font-weight: 900; letter-spacing: 0.8px; color: #000000; display: flex; align-items: center; gap: 8px;">
            <span>📡</span> RACE OPPORTUNITIES
            <span style="font-size: 0.65rem; font-weight: 900; background: #000000; color: #ffffff; padding: 2px 7px; border-radius: 4px; letter-spacing: 0.5px;">LIVE RADAR</span>
          </div>
          <div style="font-size: 0.74rem; color: #4b5563; font-weight: 700; margin-top: 2px;">
            The strategist can immediately see: <span style="font-style: italic; color: #000000;">&ldquo;What can we exploit right now?&rdquo;</span>
          </div>
        </div>
        <div style="font-family: var(--font-mono); font-size: 0.75rem; font-weight: 900; background: #f8fafc; border: 1.5px solid #000000; padding: 4px 10px; border-radius: 4px; box-shadow: 0 1px 0 #000;">
          LAP ${currentLap} / ${totalLaps}
        </div>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px;">
        <!-- Card 1: OVERTAKE -->
        <div style="background: #f0fdf4; border: 1.5px solid #16a34a; border-radius: 6px; padding: 10px 12px; box-shadow: 0 2px 0 #16a34a;">
          <div style="font-size: 0.82rem; font-weight: 900; color: #166534; margin-bottom: 4px;">
            ${overtakeTitle}
          </div>
          <div style="font-size: 0.92rem; font-weight: 900; color: #000000; font-family: var(--font-mono); margin-bottom: 3px;">
            Probability: <span style="color: #16a34a;">${overtakeProb}%</span>
          </div>
          <div style="font-size: 0.68rem; color: #374151; font-weight: 600; line-height: 1.3;">
            ${overtakeNote}
          </div>
        </div>

        <!-- Card 2: UNDERCUT -->
        <div style="background: #f0fdf4; border: 1.5px solid #16a34a; border-radius: 6px; padding: 10px 12px; box-shadow: 0 2px 0 #16a34a;">
          <div style="font-size: 0.82rem; font-weight: 900; color: #166534; margin-bottom: 4px;">
            ${undercutTitle}
          </div>
          <div style="font-size: 0.92rem; font-weight: 900; color: #000000; font-family: var(--font-mono); margin-bottom: 3px;">
            Window: <span style="color: #16a34a;">${undercutWindow}</span>
          </div>
          <div style="font-size: 0.68rem; color: #374151; font-weight: 600; line-height: 1.3;">
            ${undercutNote}
          </div>
        </div>

        <!-- Card 3: EXTEND STINT -->
        <div style="background: #fffbeb; border: 1.5px solid #d97706; border-radius: 6px; padding: 10px 12px; box-shadow: 0 2px 0 #d97706;">
          <div style="font-size: 0.82rem; font-weight: 900; color: #92400e; margin-bottom: 4px;">
            🟡 EXTEND STINT
          </div>
          <div style="font-size: 0.92rem; font-weight: 900; color: #000000; font-family: var(--font-mono); margin-bottom: 3px;">
            Potential: <span style="color: #d97706;">${potentialPos}</span>
          </div>
          <div style="font-size: 0.68rem; color: #374151; font-weight: 600; line-height: 1.3;">
            ${extendNote}
          </div>
        </div>

        <!-- Card 4: DEFEND -->
        <div style="background: #fef2f2; border: 1.5px solid #dc2626; border-radius: 6px; padding: 10px 12px; box-shadow: 0 2px 0 #dc2626;">
          <div style="font-size: 0.82rem; font-weight: 900; color: #991b1b; margin-bottom: 4px;">
            ${defendTitle}
          </div>
          <div style="font-size: 0.92rem; font-weight: 900; color: #000000; font-family: var(--font-mono); margin-bottom: 3px;">
            Threat arriving in <span style="color: #dc2626;">${defendArrival}</span>
          </div>
          <div style="font-size: 0.68rem; color: #374151; font-weight: 600; line-height: 1.3;">
            ${defendNote}
          </div>
        </div>
      </div>
    </div>
  `;
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
