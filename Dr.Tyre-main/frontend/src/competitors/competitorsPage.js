import { onSimulationUpdate, raceConfig } from '../simulation/simulation.js';
import { getDegradationDelta, getRecommendation, evaluate_undercut, getDegradationUncertainty } from '../simulation/strategy.js';
import { CIRCUITS } from '../simulation/circuits.js';

let initialized = false;
let currentModelData = null;

export function initCompetitorsPage(modelData) {
  currentModelData = modelData;
  if (initialized) return;
  initialized = true;

  onSimulationUpdate((simState) => {
    updateCompetitorsTable(simState);
  });
}

function updateCompetitorsTable(simState) {
  const tbody = document.getElementById('competitors-table-body');
  if (!tbody) return;

  if (!simState.active && simState.lap === 1 && simState.raceEvent === 'GREEN') {
    // Before race starts but after initialization, it might still be inactive.
    // We can show waiting message.
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: var(--text-muted);">Waiting for simulation to start...</td></tr>';
    return;
  }

  // Find user car
  const userCar = simState.cars.find(c => c.isUser);
  const totalLaps = simState.totalLaps;
  const currentLap = simState.lap;
  const circuit = CIRCUITS[raceConfig.trackId];
  const baseLapTime = circuit ? circuit.baseLapTimeSec : 94.0;

  let html = '';

  const sortedCars = [...simState.cars].sort((a, b) => (a.position || 0) - (b.position || 0));

  sortedCars.forEach((car) => {
    const isUser = car.isUser;
    
    // Calculate Degradation Pace Loss
    const paceLoss = getDegradationDelta(car.compound, car.tyreAge, car.setup, car.thermalState);
    const uncertainty = getDegradationUncertainty(car.compound, car.tyreAge, car.setup);
    const cliffLap = window.modelData?.compounds?.[car.compound]?.cliff_lap || 999;
    const isCliff = car.tyreAge >= cliffLap;
    
    // Recommendation
    const rec = getRecommendation(car.compound, car.tyreAge, currentLap, car.fuelPct, car.setup, null, car.thermalState);
    
    // Undercut / Overtake viability (only if it's not the user)
    let battleText = '-';
    let battleClass = '';
    
    if (!isUser && userCar) {
      // Calculate gap to user (Positive means car is ahead of user, negative means behind user)
      const gapToUser = (car.progress - userCar.progress) * baseLapTime + (car.lapsCompleted - userCar.lapsCompleted) * baseLapTime;
      
      if (gapToUser > 0 && gapToUser < 4.0) {
        // User is behind this car within 4 seconds (attacking)
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
        // User is ahead of this car within 4 seconds (defending)
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

    const trStyle = isUser ? 'style="background: rgba(0, 229, 255, 0.1); border-left: 3px solid var(--cyan);"' : '';

    const setupStr = car.setup ? `<div style="font-size:0.7em;color:var(--text-muted);">${car.setup.downforceLevel} DF / ${car.setup.balance} BAL</div>` : '';

    html += `
      <tr ${trStyle}>
        <td><strong style="${isUser ? 'color: var(--cyan);' : ''}">P${car.position}</strong></td>
        <td>
          ${isUser ? '<strong>YOU (#11)</strong>' : `AI (#${car.number})`}
          ${setupStr}
        </td>
        <td><span class="data-label" style="background: ${getCompoundColor(car.compound)}20; color: ${getCompoundColor(car.compound)}; border-color: ${getCompoundColor(car.compound)}50;">${car.compound}</span></td>
        <td>${Math.max(1, car.tyreAge)}${isCliff ? ' ⚠️ (CLIFF)' : ''}</td>
        <td style="color: #ff5252;">+${paceLoss.toFixed(2)}s <span style="font-size:0.8em;color:var(--text-muted);">&plusmn;${uncertainty.toFixed(2)}</span></td>
        <td ${recClass}>${rec.state} (${rec.optimalLap === 'N/A' || !rec.optimalLap ? 'N/A' : (String(rec.optimalLap).startsWith('Lap') ? rec.optimalLap : 'Lap ' + rec.optimalLap)})</td>
        <td class="${battleClass}">${battleText}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function getCompoundColor(compound) {
  if (compound === 'SOFT') return '#dc2626';
  if (compound === 'MEDIUM') return '#d97706';
  if (compound === 'HARD') return '#1e293b';
  return '#0284c7';
}
