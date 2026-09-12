let logisticsChart = null;
const ROUTE_DISTANCE_KM = 280;
const CRITICAL_FAILURE_TEMP = 100; // Arbitrary "Heat Index / Structural Integrity" failure point
let logisticsGridData = null;

export async function initLogisticsLab() {
  try {
    const res = await fetch('/logistics_dual_model.json');
    if (res.ok) {
      const data = await res.json();
      logisticsGridData = data.grid;
    }
  } catch (err) {
    console.error('Failed to load dual model JSON:', err);
  }

  const payloadSlider = document.getElementById('slider-payload');
  const tempSlider = document.getElementById('slider-temp');
  const rubberSelect = document.getElementById('select-rubber');
  const cooldownToggle = document.getElementById('toggle-cooldown');

  if (!payloadSlider || !tempSlider || !rubberSelect || !cooldownToggle) return;

  // Listeners
  payloadSlider.addEventListener('input', (e) => {
    document.getElementById('val-payload').innerText = `${e.target.value} Tons`;
    updateLogisticsModel();
  });

  tempSlider.addEventListener('input', (e) => {
    const v = parseInt(e.target.value);
    let timeStr = '12:00';
    if (v <= 25) timeStr = '04:00';
    else if (v <= 35) timeStr = '10:00';
    else if (v <= 45) timeStr = '14:00';
    else timeStr = '15:00';
    document.getElementById('val-temp').innerText = `${timeStr} (${v}°C)`;
    updateLogisticsModel();
  });

  rubberSelect.addEventListener('change', updateLogisticsModel);
  cooldownToggle.addEventListener('change', updateLogisticsModel);

  const fleetInput = document.getElementById('fleet-size-input');
  if (fleetInput) fleetInput.addEventListener('input', updateLogisticsModel);

  // Initial render
  updateLogisticsModel();
}

function interpolateGrid(payloadKg, tempC, isRetread) {
  if (!logisticsGridData) return null;
  const pGrids = [10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000];
  const tGrids = [20, 25, 30, 35, 40, 45, 50, 55, 60];
  
  let p = Math.max(10000, Math.min(45000, payloadKg));
  let t = Math.max(20, Math.min(60, tempC));
  const g = isRetread ? "Retread" : "Virgin";
  
  const p1 = pGrids.slice().reverse().find(x => x <= p) || pGrids[0];
  const p2 = pGrids.find(x => x >= p) || pGrids[pGrids.length-1];
  
  const t1 = tGrids.slice().reverse().find(x => x <= t) || tGrids[0];
  const t2 = tGrids.find(x => x >= t) || tGrids[tGrids.length-1];

  const dp = p2 === p1 ? 0 : (p - p1) / (p2 - p1);
  const dt = t2 === t1 ? 0 : (t - t1) / (t2 - t1);

  const getVals = (pv, tv) => logisticsGridData[`${g}_${pv}kg_${tv}C`];
  const v11 = getVals(p1, t1);
  const v21 = getVals(p2, t1);
  const v12 = getVals(p1, t2);
  const v22 = getVals(p2, t2);
  
  if (!v11 || !v21 || !v12 || !v22) return null;

  const interp = (key1, key2) => {
     const val11 = v11[key1][key2];
     const val21 = v21[key1][key2];
     const val12 = v12[key1][key2];
     const val22 = v22[key1][key2];
     
     const val_bottom = val11 * (1 - dp) + val21 * dp;
     const val_top = val12 * (1 - dp) + val22 * dp;
     return val_bottom * (1 - dt) + val_top * dt;
  };
  
  let rawSurvival = interp('cox_financial', 'survival_probability_at_280km');
  if (isNaN(rawSurvival)) rawSurvival = p >= 40000 && t >= 50 ? 0.0 : 1.0;
  rawSurvival = Math.max(0.0, Math.min(1.0, rawSurvival));
  
  return {
    heat_buildup_rate_c_per_km: interp('lme_physical', 'heat_buildup_rate_c_per_km'),
    steady_state_temp_c: interp('lme_physical', 'steady_state_temp_c'),
    hazard_ratio: interp('cox_financial', 'hazard_ratio'),
    survival_probability_at_280km: rawSurvival,
    expected_depreciation_inr: interp('cox_financial', 'expected_depreciation_inr')
  };
}

function updateLogisticsModel() {
  const payload = parseFloat(document.getElementById('slider-payload').value);
  const tarmacTemp = parseFloat(document.getElementById('slider-temp').value);
  const isRetread = document.getElementById('select-rubber').value === 'RETREAD';

  const interpData = interpolateGrid(payload * 1000, tarmacTemp, isRetread);
  
  let baseHeat = tarmacTemp;
  let heatSlope = interpData ? interpData.heat_buildup_rate_c_per_km : 0.05;
  let steadyState = interpData ? interpData.steady_state_temp_c : 120;
  
  let survivalProbAt280 = interpData ? interpData.survival_probability_at_280km : 1.0;

  const cooldownToggleEl = document.getElementById('toggle-cooldown');
  
  // Base failure calculation (without cooldown) to check edge cases
  let baseFailureKm = -1;
  for (let km = 0; km <= ROUTE_DISTANCE_KM + 50; km += 5) {
    let heat = baseHeat + (heatSlope * km);
    if (heat > steadyState) heat = steadyState;
    if (heat >= CRITICAL_FAILURE_TEMP && baseFailureKm === -1) {
      baseFailureKm = km;
    }
  }

  // Edge case: If base failure is <= 140km, we cannot reach the hub.
  const hubUnreachable = baseFailureKm !== -1 && baseFailureKm <= 140;

  if (hubUnreachable) {
    cooldownToggleEl.checked = false;
    cooldownToggleEl.disabled = true;
    cooldownToggleEl.parentElement.style.opacity = '0.5';
  } else {
    cooldownToggleEl.disabled = false;
    cooldownToggleEl.parentElement.style.opacity = '1';
  }

  // Generate data points with potential cooldown
  const distances = [];
  const heatIndex = [];
  const financialRisk = [];
  let failureKm = -1;
  const activeCooldown = cooldownToggleEl.checked;

  for (let km = 0; km <= ROUTE_DISTANCE_KM + 50; km += 5) {
    let currentHeat = baseHeat + (heatSlope * km);
    if (currentHeat > steadyState) currentHeat = steadyState;
    
    let effectiveKmForRisk = km;
    if (activeCooldown && km >= 140) {
      currentHeat -= 40; // Thermal reset
      effectiveKmForRisk -= 140; 
    }

    distances.push(km);
    heatIndex.push(currentHeat);

    if (currentHeat >= CRITICAL_FAILURE_TEMP && failureKm === -1) {
      failureKm = km;
    }
    
    let s_d = 1.0;
    if (survivalProbAt280 > 0 && survivalProbAt280 < 1) {
        // S(d) = S(280) ^ ( (d/280)^2.5 )
        s_d = Math.pow(survivalProbAt280, Math.pow(effectiveKmForRisk / 280.0, 2.5));
    } else if (survivalProbAt280 === 0) {
        s_d = effectiveKmForRisk >= 280 ? 0 : 1.0;
    }
    
    let dep = 15000 + ((1.0 - s_d) * 1500000);
    financialRisk.push(dep);
  }

  let finalSurvivalProb = survivalProbAt280;
  if (activeCooldown) {
    // Math: S(140) = S(280) ^ (0.5^2.5) = S(280)^0.1767
    // Total S = S(140)^2 = S(280)^0.353
    finalSurvivalProb = Math.pow(survivalProbAt280, 0.3535);
  }
  let finalDepreciation = 15000 + ((1.0 - finalSurvivalProb) * 1500000);

  updateLogisticsUI(distances, heatIndex, financialRisk, failureKm, hubUnreachable, activeCooldown, finalSurvivalProb, finalDepreciation);
}

function updateLogisticsUI(distances, heatIndex, financialRisk, failureKm, hubUnreachable, activeCooldown, finalSurvivalProb, finalDepreciation) {
  const survValueEl = document.getElementById('survival-value');
  const depValueEl = document.getElementById('depreciation-value');
  if (survValueEl) survValueEl.innerText = `${(finalSurvivalProb * 100).toFixed(1)}%`;
  if (depValueEl) depValueEl.innerText = `₹${Math.round(finalDepreciation).toLocaleString('en-IN')}`;
  const oracleCard = document.getElementById('logistics-oracle-card');
  const statusText = document.getElementById('logistics-status-text');
  const distanceText = document.getElementById('logistics-distance-text');
  const minimapProgress = document.getElementById('minimap-progress');
  const minimapStatus = document.getElementById('minimap-status');
  const recPanel = document.getElementById('logistics-recommendation');
  const recText = document.getElementById('logistics-recommendation-text');

  let willFail = failureKm !== -1 && failureKm <= ROUTE_DISTANCE_KM;

  // Clear previous states
  if (oracleCard) {
    oracleCard.classList.remove('logistics-danger-glass');
    oracleCard.classList.remove('logistics-intervention-glass');
  }

  if (hubUnreachable) {
    if (oracleCard) {
      oracleCard.classList.add('logistics-danger-glass');
      oracleCard.style.borderLeftColor = 'var(--red)';
    }
    if (statusText) {
      statusText.innerText = 'HUB UNREACHABLE';
      statusText.style.color = 'var(--red)';
    }
    if (distanceText) {
      distanceText.innerText = `CRITICAL: Failure at ${failureKm} km`;
    }
    if (minimapProgress) {
      minimapProgress.style.background = 'linear-gradient(90deg, var(--red) 0%, var(--red) 100%)';
      minimapProgress.style.width = `${(failureKm / ROUTE_DISTANCE_KM) * 100}%`;
    }
    if (minimapStatus) {
      minimapStatus.innerText = `DESTINATION UNREACHABLE`;
      minimapStatus.style.color = 'var(--red)';
    }
  } else if (willFail) {
    if (oracleCard) {
      oracleCard.classList.add('logistics-danger-glass');
      oracleCard.style.borderLeftColor = 'var(--red)';
    }
    if (statusText) {
      statusText.innerText = 'BLOWOUT IMMINENT';
      statusText.style.color = 'var(--red)';
    }
    if (distanceText) {
      distanceText.innerText = `Est. Failure: ${failureKm} km`;
    }
    if (minimapProgress) {
      minimapProgress.style.background = 'linear-gradient(90deg, var(--red) 0%, var(--red) 100%)';
      minimapProgress.style.width = `${(failureKm / ROUTE_DISTANCE_KM) * 100}%`;
    }
    if (minimapStatus) {
      minimapStatus.innerText = `DESTINATION UNREACHABLE`;
      minimapStatus.style.color = 'var(--red)';
    }
  } else if (activeCooldown && failureKm > ROUTE_DISTANCE_KM || (activeCooldown && failureKm === -1)) {
    // Saved by intervention
    if (oracleCard) {
      oracleCard.classList.add('logistics-intervention-glass');
      oracleCard.style.borderLeftColor = 'var(--cyan)';
    }
    if (statusText) {
      statusText.innerText = 'SAFE (INTERVENTION)';
      statusText.style.color = 'var(--cyan)';
    }
    if (distanceText) {
      distanceText.innerText = `Est. Failure: >${ROUTE_DISTANCE_KM + 30} km`;
    }
    if (minimapProgress) {
      minimapProgress.style.background = `linear-gradient(90deg, var(--green) 0%, var(--green) 50%, var(--cyan) 50%, var(--cyan) 100%)`;
      minimapProgress.style.width = `100%`;
    }
    if (minimapStatus) {
      minimapStatus.innerText = `Destination: Delhi (${ROUTE_DISTANCE_KM} km) | Cooled`;
      minimapStatus.style.color = 'var(--cyan)';
    }
  } else {
    if (oracleCard) oracleCard.style.borderLeftColor = 'var(--amber)';
    if (failureKm !== -1 && failureKm <= ROUTE_DISTANCE_KM + 30) {
      if (statusText) {
        statusText.innerText = 'MARGINAL';
        statusText.style.color = 'var(--amber)';
      }
      if (distanceText) {
        distanceText.innerText = `Est. Failure: ${failureKm} km`;
      }
      if (minimapProgress) minimapProgress.style.background = 'linear-gradient(90deg, var(--amber) 0%, var(--amber) 100%)';
    } else {
      if (statusText) {
        statusText.innerText = 'SAFE';
        statusText.style.color = 'var(--green)';
      }
      if (distanceText) {
        distanceText.innerText = `Est. Failure: >${ROUTE_DISTANCE_KM + 30} km`;
      }
      if (minimapProgress) minimapProgress.style.background = 'linear-gradient(90deg, var(--green) 0%, var(--green) 100%)';
    }
    if (minimapProgress) minimapProgress.style.width = `100%`;
    if (minimapStatus) {
      minimapStatus.innerText = `Destination: Delhi (${ROUTE_DISTANCE_KM} km)`;
      minimapStatus.style.color = 'var(--text-secondary)';
    }
  }

  // ── AI Recommendation Engine ─────────────────────────────────
  if (recPanel && recText) {
    recPanel.style.display = 'block';

    if (hubUnreachable) {
      recPanel.style.borderColor = 'rgba(255,23,68,0.4)';
      recPanel.style.background = 'rgba(255,23,68,0.05)';
      recText.innerHTML = `
        <div style="color: var(--red); font-weight: 700; margin-bottom: 8px;">⚠️ CRITICAL: MIDWAY HUB IS UNREACHABLE</div>
        <div>Tyre failure is predicted at <strong style="color:var(--red)">${failureKm} km</strong> — before the 140 km cooling station. The Thermal Reset cannot be applied. Immediate corrective actions required:</div>
        <ul style="margin: 10px 0 0 16px; padding: 0; list-style: disc;">
          <li style="margin-bottom: 6px;"><strong style="color:var(--amber)">Reduce Payload</strong> — Offload cargo to bring static load below 30T before departure.</li>
          <li style="margin-bottom: 6px;"><strong style="color:var(--cyan)">Reschedule to Night</strong> — Depart between 22:00–04:00 when tarmac temp drops below 25°C.</li>
          <li style="margin-bottom: 6px;"><strong style="color:var(--amber)">Emergency Roadside Stop</strong> — If departure is unavoidable, pull over at km ${Math.max(failureKm - 30, 10)} for a forced 45-min cooling rest before tyre reaches critical heat.</li>
          <li><strong style="color:var(--red)">Abort Route</strong> — If none of the above are possible, do NOT dispatch. Catastrophic blowout is certain.</li>
        </ul>
      `;
    } else if (activeCooldown && willFail) {
      recPanel.style.borderColor = 'rgba(255,23,68,0.4)';
      recPanel.style.background = 'rgba(255,23,68,0.05)';
      recText.innerHTML = `
        <div style="color: var(--red); font-weight: 700; margin-bottom: 8px;">⚠️ CRITICAL: INTERVENTION INSUFFICIENT</div>
        <div>Even with the 35-min Thermal Reset, the tyre is still projected to fail at <strong style="color:var(--red)">${failureKm} km</strong>. You MUST reduce payload or wait for a cooler departure time.</div>
      `;
    } else if (willFail) {
      recPanel.style.borderColor = 'rgba(255,23,68,0.3)';
      recPanel.style.background = 'rgba(255,23,68,0.05)';
      recText.innerHTML = `
        <div style="color: var(--amber); font-weight: 700; margin-bottom: 8px;">⚡ RECOMMENDED: ENABLE THERMAL RESET</div>
        <div>Tyre failure predicted at <strong style="color:var(--red)">${failureKm} km</strong>, but the Midway Hub at 140 km is reachable. Enable the <strong>35-min Thermal Reset</strong> checkbox to schedule a cooling stop and prevent the blowout.</div>
      `;
    } else if (activeCooldown) {
      recPanel.style.borderColor = 'rgba(0,229,255,0.3)';
      recPanel.style.background = 'rgba(0,229,255,0.05)';
      recText.innerHTML = `
        <div style="color: var(--cyan); font-weight: 700; margin-bottom: 8px;">✅ INTERVENTION ACTIVE — ROUTE SAFE</div>
        <div>The 35-min Thermal Reset at 140 km will drop the tyre Heat Index by 40 points, allowing the truck to complete the remaining 140 km safely below the failure threshold. <strong style="color:var(--cyan)">Dispatch approved.</strong></div>
      `;
    } else {
      const payload = parseFloat(document.getElementById('slider-payload').value);
      if (failureKm !== -1 && failureKm <= ROUTE_DISTANCE_KM + 30) {
        recPanel.style.borderColor = 'rgba(255,171,0,0.3)';
        recPanel.style.background = 'rgba(255,171,0,0.05)';
        recText.innerHTML = `
          <div style="color: var(--amber); font-weight: 700; margin-bottom: 8px;">⚠️ MARGINAL — MONITOR CLOSELY</div>
          <div>Tyre failure is predicted shortly after arrival at <strong style="color:var(--amber)">${failureKm} km</strong>. The truck will likely reach Delhi, but with zero safety margin. Consider enabling the Thermal Reset or reducing payload by ${Math.ceil(payload * 0.15)}T for a safer margin.</div>
        `;
      } else {
        recPanel.style.borderColor = 'rgba(0,0,0,0.08)';
        recPanel.style.background = 'rgba(0,0,0,0.03)';
        recText.innerHTML = `
          <div style="color: var(--green); font-weight: 700; margin-bottom: 8px;">✅ ALL CLEAR — DISPATCH APPROVED</div>
          <div>Current configuration is within safe operating limits. Tyres are projected to remain well below the critical failure threshold for the entire Jaipur → Delhi route. No intervention required.</div>
        `;
      }
    }
  }

  // Removing the old Energy card update since we repurposed it to Depreciation Risk cards
  // We updated those at the top of updateLogisticsUI.

  // ── Traceability Ledger ───────────────────────────────────────
  const ledger = document.getElementById('traceability-ledger');
  if (ledger) {
    const payload = parseFloat(document.getElementById('slider-payload').value);
    const checkpoints = [0, 50, 100, 140, 200, 280];
    let ledgerHTML = '';

    checkpoints.forEach(km => {
      const idx = distances.indexOf(km);
      const heat = idx !== -1 ? heatIndex[idx] : (heatIndex[Math.round(km / 5)] || 0);
      const heatRounded = Math.round(heat * 10) / 10;
      const isFailed = heat >= CRITICAL_FAILURE_TEMP;
      const isReset = activeCooldown && km === 140;
      const heatBefore = isReset ? Math.round((heat + 40) * 10) / 10 : null;

      if (isReset) {
        ledgerHTML += `<div style="color: var(--cyan);">[⚡] ${String(km).padStart(3, '0')}km | Tyre Temp: ${heatBefore}°C → THERMAL RESET APPLIED → ${heatRounded}°C | Payload: ${payload}T</div>`;
      } else if (isFailed) {
        ledgerHTML += `<div style="color: var(--red);">[ERR] ${String(km).padStart(3, '0')}km | Tyre Temp: ${heatRounded}°C | Payload: ${payload}T | Status: ██ STRUCTURAL FAILURE ██</div>`;
      } else if (km === 280) {
        ledgerHTML += `<div style="color: var(--green);">[OK]  ${String(km).padStart(3, '0')}km | Tyre Temp: ${heatRounded}°C | Payload: ${payload}T | Status: ARRIVED DELHI ✓</div>`;
      } else {
        ledgerHTML += `<div>[OK]  ${String(km).padStart(3, '0')}km | Tyre Temp: ${heatRounded}°C | Payload: ${payload}T | Status: NOMINAL</div>`;
      }
    });

    ledger.innerHTML = ledgerHTML;
  }

  // ── Fleet Scaling Projector ───────────────────────────────────
  // SOURCE: MoRTH 2025 — 5.13 lakh road accidents, ~11,000-15,000 tyre-related.
  // SOURCE: NHAI — Overloading is primary cause; 30% of highway accidents.
  // SOURCE: MRF/Apollo — ₹15,000/tyre avg, 6 tyres per truck axle set.
  const fleetInputEl = document.getElementById('fleet-size-input');
  const fleetBlowouts = document.getElementById('fleet-blowouts');
  const fleetSavings = document.getElementById('fleet-savings');
  const fleetLives = document.getElementById('fleet-lives');

  if (fleetInputEl && fleetBlowouts && fleetSavings && fleetLives) {
    const fleetSize = parseInt(fleetInputEl.value) || 500;
    const tripsPerYear = 300;
    const totalTrips = fleetSize * tripsPerYear;
    
    const expectedBlowouts = totalTrips * (1.0 - finalSurvivalProb);
    const annualDepreciation = totalTrips * finalDepreciation;
    
    fleetBlowouts.innerText = Math.round(expectedBlowouts).toLocaleString('en-IN');
    fleetBlowouts.style.color = expectedBlowouts > 0 ? 'var(--amber)' : 'var(--text-muted)';
    
    const crores = (annualDepreciation / 10000000).toFixed(2);
    const lakhs = (annualDepreciation / 100000).toFixed(1);
    
    if (annualDepreciation >= 10000000) {
      fleetSavings.innerText = `₹${crores} Cr`;
      fleetSavings.style.color = 'var(--red)';
    } else if (annualDepreciation > 0) {
      fleetSavings.innerText = `₹${lakhs} L`;
      fleetSavings.style.color = 'var(--amber)';
    } else {
      fleetSavings.innerText = '—';
      fleetSavings.style.color = 'var(--text-muted)';
    }

    const fatalIncidents = Math.round(expectedBlowouts * 0.125); 
    fleetLives.innerText = fatalIncidents > 0 ? `~${fatalIncidents.toLocaleString('en-IN')}` : '0';
    fleetLives.style.color = fatalIncidents > 0 ? 'var(--red)' : 'var(--text-muted)';
  }

  // Update Chart
  const ctx = document.getElementById('chart-logistics');
  if (!ctx) return;

  if (logisticsChart) {
    logisticsChart.data.datasets[0].data = heatIndex;
    logisticsChart.data.datasets[0].borderColor = willFail ? '#ff1744' : '#ffc107'; 
    logisticsChart.data.datasets[0].backgroundColor = willFail ? 'rgba(255,23,68,0.1)' : 'rgba(255,171,0,0.1)';
    
    logisticsChart.data.datasets[1].data = financialRisk;
    
    logisticsChart.options.scales.y.max = Math.max(120, ...heatIndex);
    logisticsChart.update('none'); 
    return;
  }

  logisticsChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: distances,
      datasets: [
        {
          label: 'Physical Temp (°C)',
          data: heatIndex,
          borderColor: willFail ? '#ff1744' : '#ffc107',
          backgroundColor: willFail ? 'rgba(255,23,68,0.1)' : 'rgba(255,171,0,0.1)',
          borderWidth: 3,
          pointRadius: 0,
          fill: false,
          tension: 0.1,
          yAxisID: 'y'
        },
        {
          label: 'Financial Risk (₹)',
          data: financialRisk,
          borderColor: '#00e5ff',
          backgroundColor: 'rgba(0, 229, 255, 0.1)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.1,
          yAxisID: 'y1'
        },
        {
          label: 'Critical Failure Threshold',
          data: distances.map(() => CRITICAL_FAILURE_TEMP),
          borderColor: '#ffc107',
          borderWidth: 2,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
          tension: 0,
          yAxisID: 'y'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: 'rgba(0,0,0,0.7)' }, onClick: (e) => e.stopPropagation() },
        annotation: {
          annotations: {
            line1: {
              type: 'line',
              xMin: ROUTE_DISTANCE_KM,
              xMax: ROUTE_DISTANCE_KM,
              borderColor: 'rgba(0,0,0,0.3)',
              borderWidth: 2,
              borderDash: [10, 5],
              label: {
                display: true,
                content: 'Delhi (280 km)',
                position: 'end',
                color: 'rgba(0,0,0,0.7)',
                backgroundColor: 'rgba(0,0,0,0.5)'
              }
            }
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          border: { display: true, color: '#000000', width: 2 },
          title: { display: true, text: 'Distance (km)', color: '#000000' },
          grid: { tickColor: '#000000', color: 'rgba(0,0,0,0.06)' },
          ticks: { color: '#000000' },
          min: 0,
          max: ROUTE_DISTANCE_KM + 50
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          border: { display: true, color: '#000000', width: 2 },
          title: { display: true, text: 'Tyre Temperature (°C)', color: '#000000' },
          grid: { tickColor: '#000000', color: 'rgba(0,0,0,0.06)' },
          ticks: { color: '#000000' },
          min: 20,
          max: 120
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          border: { display: true, color: '#000000', width: 2 },
          title: { display: true, text: 'Expected Depreciation (₹)', color: '#000000' },
          grid: { tickColor: '#000000', drawOnChartArea: false }, // only draw grid lines for one axis
          ticks: { color: '#000000' },
          min: 15000
        }
      }
    }
  });
}
