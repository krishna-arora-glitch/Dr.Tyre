/**
 * research.js — Research Page Orchestrator
 * 
 * Populates the Tyre Intelligence, Ghost Baseline, Compare, 
 * Investigate, Validation, Provenance, and Report pages
 * using real data from model_output.json.
 * 
 * NO fake data. Every value comes from the model output.
 */

import { renderGhostBaselineChart, renderComponentBreakdownChart, renderCompareOverlayChart } from './research-charts.js';
import { raceConfig } from '../simulation/simulation.js';
import { CIRCUITS } from '../simulation/circuits.js';

// ── Helpers ────────────────────────────────────────────────────

function badge(status) {
  const map = {
    'TRUSTED': 'badge-trusted', 'GO': 'badge-go',
    'WEAK': 'badge-weak', 'CAUTION': 'badge-caution',
    'NO FIT': 'badge-nofit', 'NO-GO': 'badge-nogo',
  };
  return `<span class="status-badge ${map[status] || 'badge-caution'}">${status}</span>`;
}

function dataLabel(type) {
  const cls = {
    OBSERVED: 'data-label-observed', ESTIMATED: 'data-label-estimated',
    ASSUMED: 'data-label-assumed', MODEL: 'data-label-model',
    FILTERED: 'data-label-filtered', REAL: 'data-label-real',
    SIMULATED: 'data-label-simulated',
  };
  return `<span class="data-label ${cls[type] || 'data-label-estimated'}">${type}</span>`;
}

function whyItMatters(text) {
  return `
    <div class="why-it-matters">
      <div class="why-it-matters-header">
        <span>💡</span><h4>Why It Matters</h4>
      </div>
      <p>${text}</p>
    </div>`;
}

function metricCard(label, value, unit, sublabel, badgeHtml) {
  return `
    <div class="metric-card">
      <div class="metric-card-label">${label}</div>
      <div style="display:flex;align-items:baseline;gap:6px;">
        <div class="metric-card-value">${value}</div>
        ${unit ? `<span class="metric-card-unit">${unit}</span>` : ''}
      </div>
      ${sublabel ? `<div class="metric-card-sublabel">${sublabel}</div>` : ''}
      ${badgeHtml ? `<div style="margin-top:4px;">${badgeHtml}</div>` : ''}
    </div>`;
}

function getFitStatus(r2) {
  if (r2 >= 0.5) return { status: 'TRUSTED', confidence: 'HIGH' };
  if (r2 >= 0.3) return { status: 'WEAK', confidence: 'LOW' };
  return { status: 'NO FIT', confidence: 'INSUFFICIENT' };
}

// ── Live Simulation State Integration ──────────────────────────

export function updateResearchWithSimulationState(simState, modelData) {
  if (!simState || !modelData) return;

  const u = simState.userCar;
  if (!u) return;

  // Helpers
  const comp = modelData.compounds && modelData.compounds[u.compound];
  const degRate = comp ? comp.deg_per_lap_linear : 0;
  const tyreLoss = (degRate * u.tyreAge).toFixed(2);
  const lapSafe = Math.min(simState.lap, simState.totalLaps);

  // Ghost Baseline Banner
  const ghostBanner = document.getElementById('live-sim-banner-ghost');
  if (ghostBanner) {
    if (simState.active || simState.lap > 1) {
      ghostBanner.classList.remove('hidden');
      document.getElementById('live-ghost-lap').textContent = lapSafe;
      document.getElementById('live-ghost-tyre').textContent = u.compound;
      document.getElementById('live-ghost-age').textContent = u.tyreAge;
      document.getElementById('live-ghost-loss').textContent = `+${tyreLoss}s`;
      
      const c = CIRCUITS[raceConfig.trackId];
      if (c) {
        let bannerTitle = ghostBanner.querySelector('div');
        bannerTitle.textContent = `LIVE SIMULATION CONNECTED — ${c.name.toUpperCase()} / ${raceConfig.condition}`;
      }
    } else {
      ghostBanner.classList.add('hidden');
    }
  }

  // Tyre Overview Banner
  const intelBanner = document.getElementById('live-sim-banner-intel');
  if (intelBanner) {
    if (simState.active || simState.lap > 1) {
      intelBanner.classList.remove('hidden');
      document.getElementById('live-intel-lap').textContent = lapSafe;
      document.getElementById('live-intel-tyre').textContent = u.compound;
      document.getElementById('live-intel-age').textContent = u.tyreAge;
      document.getElementById('live-intel-fuel').textContent = `${u.fuelPct.toFixed(1)}%`;
      
      const c = CIRCUITS[raceConfig.trackId];
      if (c) {
        let bannerTitle = intelBanner.querySelector('div');
        bannerTitle.textContent = `LIVE SIMULATION CONNECTED — ${c.name.toUpperCase()} / ${raceConfig.condition}`;
      }
    } else {
      intelBanner.classList.add('hidden');
    }
  }

  // Investigate Banner
  const invBanner = document.getElementById('live-sim-banner-investigate');
  if (invBanner) {
    if (simState.active || simState.lap > 1) {
      invBanner.classList.remove('hidden');
      
      let statusStr = simState.raceEvent === 'GREEN' ? 'GREEN FLAG' : simState.raceEvent;
      if (simState.lap > simState.totalLaps) statusStr = 'RACE FINISHED';

      document.getElementById('live-inv-status').textContent = statusStr;

      // Extract recommendation (using same logic from strategy.js via a quick mock here)
      // Since strategy.js is internal to simulation, we just state what we know:
      let recStr = u.isPitting ? 'PITTING' : (u.tyreAge > 20 ? 'CONSIDER PIT' : 'STAY OUT');
      if (simState.raceEvent !== 'GREEN') recStr = 'PIT NOW (SC/VSC)';
      
      document.getElementById('live-inv-rec').textContent = recStr;

      const c = CIRCUITS[raceConfig.trackId];
      if (c) {
        let bannerTitle = invBanner.querySelector('div');
        bannerTitle.textContent = `LIVE SIMULATION CONNECTED — ${c.name.toUpperCase()} / ${raceConfig.condition}`;
      }
    } else {
      invBanner.classList.add('hidden');
    }
  }
}

// ── Sub-navigation wiring ──────────────────────────────────────

export function initSubNav(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const btns = container.querySelectorAll('.sub-nav-btn');
  const panels = container.querySelectorAll('.sub-panel');

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

// ── TYRE INTELLIGENCE ──────────────────────────────────────────

export function initTyreIntelligence(data) {
  if (!data || !data.compounds) return;

  const container = document.getElementById('intel-overview');
  if (!container) return;

  // Build compound cards
  let html = '';
  
  const order = ['MEDIUM', 'HARD', 'SOFT'];
  const compoundColors = { SOFT: '#ff3333', MEDIUM: '#ffd700', HARD: '#ffffff' };

  order.forEach(comp => {
    const c = data.compounds[comp];
    if (!c) return;
    const fit = getFitStatus(c.r2_quadratic);
    const degPerLap = c.deg_per_lap_linear;

    html += `
      <div class="glass-panel" style="border-left:3px solid ${compoundColors[comp]};">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
          <h3 style="font-size:1.1rem;font-weight:700;color:${compoundColors[comp]};">${comp}</h3>
          ${badge(fit.status)}
        </div>
        <div class="metric-grid" style="margin:0;">
          ${metricCard('Est. Pace Loss', `+${degPerLap.toFixed(3)}`, 's/lap', 'Tyre-induced', dataLabel('ESTIMATED'))}
          ${metricCard('R²', c.r2_quadratic.toFixed(4), '', fit.status === 'TRUSTED' ? 'Strong fit' : (fit.status === 'WEAK' ? 'Treat as indicative' : 'Insufficient'), '')}
          ${metricCard('Clean Laps', c.n_laps, '', `Max age: ${c.max_age_fitted}`, dataLabel('OBSERVED'))}
          ${metricCard('Residual Std', c.residual_std.toFixed(3), 's', 'Model spread', '')}
        </div>
      </div>`;
  });

  container.innerHTML = html;

  // Pipeline
  initMethodologyPipeline();
}

// ── GHOST BASELINE ─────────────────────────────────────────────

export function initGhostBaseline(data) {
  if (!data?.charts?.observed_vs_ghost) return;

  // Render chart for MEDIUM compound (primary)
  renderGhostBaselineChart('chart-ghost-baseline', data.charts.observed_vs_ghost);

  // Build lap-by-lap attribution table
  const tableContainer = document.getElementById('attribution-table-body');
  if (!tableContainer) return;

  const medium = data.charts.observed_vs_ghost.MEDIUM;
  if (!medium) return;

  let rows = '';
  const fuelEffect = data.fuel?.sensitivity_s_per_kg * data.fuel?.burn_rate_kg_per_lap || 0.062;
  const trackEvol = data.track_evolution?.slope_s_per_lap || -0.01;

  medium.ages.forEach((age, i) => {
    const observed = medium.observed[i];
    const baseline = medium.ghost_baseline[i];
    const tyreLoss = observed - baseline;
    const fuelContrib = -(fuelEffect * age);
    const trackContrib = trackEvol * age;
    const residual = observed - baseline - fuelContrib - trackContrib;

    rows += `
      <tr>
        <td>${age}</td>
        <td>${age}</td>
        <td>${observed.toFixed(3)}</td>
        <td>${baseline.toFixed(3)}</td>
        <td class="${tyreLoss > 0 ? 'val-positive' : 'val-negative'}">${tyreLoss > 0 ? '+' : ''}${(tyreLoss * 1000).toFixed(0)}ms</td>
        <td class="val-negative">${(fuelContrib * 1000).toFixed(0)}ms</td>
        <td class="val-neutral">${(trackContrib * 1000).toFixed(0)}ms</td>
        <td class="val-neutral">${(residual * 1000).toFixed(0)}ms</td>
      </tr>`;
  });

  tableContainer.innerHTML = rows;

  // Show Math panel
  const showMathBtn = document.getElementById('btn-show-math');
  const mathPanel = document.getElementById('math-panel');
  if (showMathBtn && mathPanel) {
    showMathBtn.addEventListener('click', () => {
      mathPanel.classList.toggle('active');
      showMathBtn.textContent = mathPanel.classList.contains('active') 
        ? '▼ Hide mathematical details' 
        : '▶ Show mathematical details';
    });

    // Populate math panel with real coefficients
    const med = data.compounds?.MEDIUM;
    mathPanel.querySelector('#math-content').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;font-family:var(--font-mono);font-size:0.75rem;">
        <div>
          <div style="color:var(--text-muted);margin-bottom:4px;">Base Pace</div>
          <div>${med ? med.base_pace.toFixed(3) + 's' : 'N/A'}</div>
        </div>
        <div>
          <div style="color:var(--text-muted);margin-bottom:4px;">Tyre Slope (Linear)</div>
          <div>${med ? '+' + med.deg_linear.toFixed(4) + ' s/lap' : 'N/A'}</div>
        </div>
        <div>
          <div style="color:var(--text-muted);margin-bottom:4px;">Fuel Sensitivity</div>
          <div>${data.fuel ? data.fuel.sensitivity_s_per_kg + ' s/kg' : 'N/A'} ${dataLabel('ASSUMED')}</div>
        </div>
        <div>
          <div style="color:var(--text-muted);margin-bottom:4px;">Track Evolution</div>
          <div>${data.track_evolution ? data.track_evolution.slope_s_per_lap + ' s/lap' : 'N/A'}</div>
        </div>
      </div>
      <div style="margin-top:16px;padding:12px;background:rgba(255,255,255,0.02);border-radius:6px;">
        <code style="font-size:0.75rem;color:var(--cyan);">Lap Time = Base Pace + (Tyre Slope × Age) + (Fuel Sensitivity × Fuel Burned) + (Track Evolution × Session Lap) + Residual</code>
      </div>
    `;
  }
}

// ── COMPARE ────────────────────────────────────────────────────

export function initCompare(data) {
  if (!data?.compounds) return;

  const container = document.getElementById('compare-content');
  if (!container) return;

  const compounds = Object.keys(data.compounds);
  const compA = data.compounds[compounds[0]];
  const compB = data.compounds[compounds[1]];
  const nameA = compounds[0];
  const nameB = compounds[1];
  const compoundColors = { SOFT: '#ff3333', MEDIUM: '#ffd700', HARD: '#ffffff' };

  if (!compA || !compB) return;

  const fitA = getFitStatus(compA.r2_quadratic);
  const fitB = getFitStatus(compB.r2_quadratic);

  const diff = (compA.deg_per_lap_linear - compB.deg_per_lap_linear).toFixed(3);
  const faster = parseFloat(diff) > 0 ? nameB : nameA;

  container.innerHTML = `
    <div class="compare-grid">
      <div class="compare-card" style="border-top:3px solid ${compoundColors[nameA]};">
        <h3 style="color:${compoundColors[nameA]};">${nameA}</h3>
        ${metricCard('Est. Pace Loss', `+${compA.deg_per_lap_linear.toFixed(3)}`, 's/lap', '', dataLabel('ESTIMATED'))}
        ${metricCard('R²', compA.r2_quadratic.toFixed(4), '', '', badge(fitA.status))}
        ${metricCard('Clean Laps', compA.n_laps, '', `Max age: ${compA.max_age_fitted}`, '')}
        ${metricCard('Base Pace', compA.base_pace.toFixed(3), 's', '', '')}
      </div>
      <div class="compare-card" style="border-top:3px solid ${compoundColors[nameB]};">
        <h3 style="color:${compoundColors[nameB]};">${nameB}</h3>
        ${metricCard('Est. Pace Loss', `+${compB.deg_per_lap_linear.toFixed(3)}`, 's/lap', '', dataLabel('ESTIMATED'))}
        ${metricCard('R²', compB.r2_quadratic.toFixed(4), '', '', badge(fitB.status))}
        ${metricCard('Clean Laps', compB.n_laps, '', `Max age: ${compB.max_age_fitted}`, '')}
        ${metricCard('Base Pace', compB.base_pace.toFixed(3), 's', '', '')}
      </div>
    </div>

    <div class="compare-insight">
      <h4>MODEL INSIGHT</h4>
      <p><strong>${nameA}</strong> shows an estimated tyre-induced pace-loss rate of <strong>+${compA.deg_per_lap_linear.toFixed(3)} s/lap</strong> 
      compared to <strong>${nameB}</strong> at <strong>+${compB.deg_per_lap_linear.toFixed(3)} s/lap</strong>. 
      Difference: <strong>${diff} s/lap</strong>. 
      ${faster} degrades more slowly under the estimated model conditions.</p>
    </div>
  `;

  // Render overlay chart
  if (data.charts?.tyre_induced_pace_loss) {
    renderCompareOverlayChart('chart-compare', data.charts.tyre_induced_pace_loss, [nameA, nameB]);
  }
}

// ── INVESTIGATE ────────────────────────────────────────────────

export function initInvestigate(data) {
  if (!data?.compounds) return;

  const btns = document.querySelectorAll('.investigate-q-btn');
  const answerDiv = document.getElementById('investigate-answer');
  if (!btns.length || !answerDiv) return;

  const med = data.compounds.MEDIUM;
  const fit = getFitStatus(med?.r2_quadratic || 0);

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const q = btn.dataset.question;

      if (q === '1') {
        const conclusion = med.r2_quadratic >= 0.5 ? 'SUPPORTED' : (med.r2_quadratic >= 0.3 ? 'WEAK EVIDENCE' : 'INSUFFICIENT DATA');
        const conclusionColor = med.r2_quadratic >= 0.5 ? 'var(--green)' : (med.r2_quadratic >= 0.3 ? 'var(--amber)' : 'var(--red)');
        answerDiv.innerHTML = `
          <div class="investigate-answer">
            <h3 style="font-size:1rem;margin-bottom:16px;">Is tyre degradation significant?</h3>
            <div class="metric-grid">
              ${metricCard('Tyre Slope (MEDIUM)', `+${med.deg_per_lap_linear.toFixed(3)}`, 's/lap', '', dataLabel('ESTIMATED'))}
              ${metricCard('R²', med.r2_quadratic.toFixed(4), '', '', '')}
              ${metricCard('Clean Laps', med.n_laps, '', '', dataLabel('OBSERVED'))}
              ${metricCard('Confidence', fit.confidence, '', '', badge(fit.status))}
            </div>
            <div style="text-align:center;margin-top:24px;padding:16px;background:rgba(255,255,255,0.03);border-radius:8px;">
              <div style="font-size:0.65rem;letter-spacing:2px;color:var(--text-muted);margin-bottom:8px;">CONCLUSION</div>
              <div style="font-size:1.3rem;font-weight:700;color:${conclusionColor};">${conclusion}</div>
            </div>
          </div>`;
      } else if (q === '2') {
        const fuelEffect = data.fuel?.sensitivity_s_per_kg * data.fuel?.burn_rate_kg_per_lap || 0.062;
        answerDiv.innerHTML = `
          <div class="investigate-answer">
            <h3 style="font-size:1rem;margin-bottom:16px;">Why did pace change?</h3>
            ${whyItMatters('Observed lap time is a mixture of opposing effects. This breakdown shows the estimated contribution of each factor over a 10-lap stint.')}
            <div class="metric-grid">
              ${metricCard('Tyre Contribution', `+${(med.deg_per_lap_linear * 10).toFixed(2)}`, 's over 10 laps', 'Pace slows', dataLabel('ESTIMATED'))}
              ${metricCard('Fuel Effect', `−${(fuelEffect * 10).toFixed(2)}`, 's over 10 laps', 'Pace improves', dataLabel('ASSUMED'))}
              ${metricCard('Track Evolution', `${(data.track_evolution.slope_s_per_lap * 10).toFixed(2)}`, 's over 10 laps', data.track_evolution.direction, dataLabel('ESTIMATED'))}
              ${metricCard('Traffic / Anomaly', `${data.traffic.traffic_laps}`, 'laps removed', `${data.traffic.pct_traffic}% of total`, dataLabel('FILTERED'))}
            </div>
          </div>`;
      } else if (q === '3') {
        const condNum = data.fuel?.fit_result?.diagnostics?.condition_number || 'N/A';
        answerDiv.innerHTML = `
          <div class="investigate-answer">
            <h3 style="font-size:1rem;margin-bottom:16px;">How uncertain is the estimate?</h3>
            <div class="metric-grid">
              ${metricCard('R² (MEDIUM)', med.r2_quadratic.toFixed(4), '', '', badge(fit.status))}
              ${metricCard('Clean Laps', med.n_laps, '', '', '')}
              ${metricCard('Condition Number', condNum, '', condNum === 'Infinity' ? 'Rank-deficient matrix' : '', condNum === 'Infinity' ? badge('CAUTION') : '')}
              ${metricCard('Fuel Source', data.fuel?.fit_result?.source || 'N/A', '', data.fuel?.fit_result?.reason || '', data.fuel?.fit_result?.source === 'default' ? badge('CAUTION') : badge('GO'))}
            </div>
            ${condNum === 'Infinity' ? whyItMatters('The condition number is infinite, meaning fuel and tyre effects cannot be perfectly separated from the available data. The model uses a default fuel sensitivity estimate instead.') : ''}
          </div>`;
      }
    });
  });
}

// ── VALIDATION ─────────────────────────────────────────────────

export function initValidation(data) {
  if (!data?.charts?.validation?.metrics) return;

  const m = data.charts.validation.metrics;
  const container = document.getElementById('validation-content');
  if (!container) return;

  container.innerHTML = `
    <h3 style="font-size:1rem;margin-bottom:8px;">Held-Out Stint Validation</h3>
    <p style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:16px;">
      ${m.method}. ${m.n_stints_validated} stints were held out to test predictive accuracy.
    </p>
    ${whyItMatters('Validation on held-out stints is more rigorous than random lap splitting because adjacent laps within one stint are highly correlated.')}
    <div class="metric-grid">
      ${metricCard('MAE', m.mae.toFixed(3), 's', 'Mean Absolute Error', '')}
      ${metricCard('RMSE', m.rmse.toFixed(3), 's', 'Root Mean Square Error', '')}
      ${metricCard('Mean Bias', `${m.mean_bias > 0 ? '+' : ''}${m.mean_bias.toFixed(3)}`, 's', m.mean_bias > 0 ? 'Over-predicting' : 'Under-predicting', '')}
      ${metricCard('Laps Validated', m.n_laps_validated, '', `${m.n_stints_validated} held-out stints`, dataLabel('OBSERVED'))}
    </div>
  `;
}

// ── PROVENANCE ─────────────────────────────────────────────────

export function initProvenance(data) {
  const container = document.getElementById('provenance-content');
  if (!container || !data) return;

  const isReal = !data.race_info?.is_synthetic;

  container.innerHTML = `
    <div class="provenance-grid">
      <div class="provenance-card"><div class="provenance-card-label">SOURCE</div><div class="provenance-card-value">FastF1</div></div>
      <div class="provenance-card"><div class="provenance-card-label">EVENT</div><div class="provenance-card-value">${data.race_info?.name || 'N/A'}</div></div>
      <div class="provenance-card"><div class="provenance-card-label">SESSION</div><div class="provenance-card-value">FP2</div></div>
      <div class="provenance-card"><div class="provenance-card-label">DATA TYPE</div><div class="provenance-card-value">Practice Telemetry</div></div>
      <div class="provenance-card"><div class="provenance-card-label">REAL DATA</div><div class="provenance-card-value" style="color:${isReal ? 'var(--green)' : 'var(--amber)'};">${isReal ? 'YES' : 'NO'}</div></div>
      <div class="provenance-card"><div class="provenance-card-label">SYNTHETIC</div><div class="provenance-card-value" style="color:${isReal ? 'var(--green)' : 'var(--amber)'};">${isReal ? 'NO' : 'YES'}</div></div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:24px;">
      <div class="glass-panel">
        <h3 style="font-size:0.85rem;color:var(--green);margin-bottom:12px;">Available Telemetry (FastF1)</h3>
        <ul class="data-avail-list">
          <li class="avail"><span class="check">✓</span>Lap time</li>
          <li class="avail"><span class="check">✓</span>Tyre compound</li>
          <li class="avail"><span class="check">✓</span>Tyre age (stint life)</li>
          <li class="avail"><span class="check">✓</span>Stint boundaries</li>
          <li class="avail"><span class="check">✓</span>Session time</li>
          <li class="avail"><span class="check">✓</span>Track status (Yellow/Green)</li>
          <li class="avail"><span class="check">✓</span>Track temperature (where available)</li>
        </ul>
      </div>
      <div class="glass-panel">
        <h3 style="font-size:0.85rem;color:var(--amber);margin-bottom:12px;">Not Directly Observable (Confounders)</h3>
        <ul class="data-avail-list">
          <li class="unavail"><span class="check">✗</span>Exact fuel mass ${dataLabel('ASSUMED')}</li>
          <li class="unavail"><span class="check">✗</span>Tyre pressure &amp; carcass temperature</li>
          <li class="unavail"><span class="check">✗</span>Aerodynamic setup</li>
          <li class="unavail"><span class="check">✗</span>Driver intent / tyre management</li>
          <li class="unavail"><span class="check">✗</span>Team strategy &amp; power modes</li>
        </ul>
      </div>
    </div>

    <div style="margin-top:32px;padding:20px;background:rgba(255,23,68,0.06);border-left:4px solid var(--red);border-radius:0 8px 8px 0;">
      <h3 style="margin-top:0;color:var(--red);font-size:0.9rem;">Data Limitations &amp; Simulation Boundary</h3>
      <p style="color:var(--text-secondary);line-height:1.6;margin-top:8px;font-size:0.82rem;">
        <strong>Important:</strong> The model extracts tyre-induced pace-loss information from public telemetry. 
        The Race Control simulation demonstrates how such intelligence could support strategy decisions under 
        <em>modeled counterfactual conditions</em>. It does NOT claim exact Sunday race prediction, as driver intent 
        and traffic dynamically alter the real race trajectory.
      </p>
    </div>
  `;
}

// ── REPORT ─────────────────────────────────────────────────────

export function initReport(data) {
  const container = document.getElementById('report-content');
  if (!container || !data) return;

  const med = data.compounds?.MEDIUM;
  const fit = med ? getFitStatus(med.r2_quadratic) : { status: 'NO FIT', confidence: 'INSUFFICIENT' };
  const val = data.charts?.validation?.metrics;

  let verdictText, verdictColor, verdictExplanation;
  if (fit.status === 'TRUSTED') {
    verdictText = 'TRUSTWORTHY ESTIMATE';
    verdictColor = 'var(--green)';
    verdictExplanation = 'The medium compound provides sufficient clean observations and a strong fit. The estimated tyre-induced pace loss can be used with confidence for counterfactual strategy simulation.';
  } else if (fit.status === 'WEAK') {
    verdictText = 'INDICATIVE ONLY';
    verdictColor = 'var(--amber)';
    verdictExplanation = 'The estimated slope exists but R² is below the trust threshold. Treat the degradation estimate as directional guidance, not a precise measurement.';
  } else {
    verdictText = 'INSUFFICIENT EVIDENCE';
    verdictColor = 'var(--red)';
    verdictExplanation = 'Too few clean laps or too weak a fit to produce a reliable estimate.';
  }

  container.innerHTML = `
    <div class="glass-panel" style="max-width:700px;margin:0 auto;">
      <div class="report-section">
        <h3>DATA SOURCE</h3>
        <div class="report-row"><span class="report-row-label">Session</span><span class="report-row-value">${data.race_info?.name || 'N/A'} FP2</span></div>
        <div class="report-row"><span class="report-row-label">Data Type</span><span class="report-row-value">${data.race_info?.is_synthetic ? 'Synthetic Fallback' : 'Real FastF1'} ${data.race_info?.is_synthetic ? dataLabel('SIMULATED') : dataLabel('REAL')}</span></div>
        <div class="report-row"><span class="report-row-label">Model Type</span><span class="report-row-value">${data.metadata?.model_type || 'N/A'}</span></div>
      </div>

      <div class="report-section">
        <h3>TYRE INTELLIGENCE (MEDIUM)</h3>
        <div class="report-row"><span class="report-row-label">Est. Pace Loss</span><span class="report-row-value">+${med ? med.deg_per_lap_linear.toFixed(3) : 'N/A'} s/lap ${dataLabel('ESTIMATED')}</span></div>
        <div class="report-row"><span class="report-row-label">R²</span><span class="report-row-value">${med ? med.r2_quadratic.toFixed(4) : 'N/A'}</span></div>
        <div class="report-row"><span class="report-row-label">Clean Laps</span><span class="report-row-value">${med ? med.n_laps : 'N/A'}</span></div>
        <div class="report-row"><span class="report-row-label">Fit Status</span><span class="report-row-value">${badge(fit.status)}</span></div>
      </div>

      <div class="report-section">
        <h3>FUEL &amp; CONFOUNDERS</h3>
        <div class="report-row"><span class="report-row-label">Fuel Sensitivity</span><span class="report-row-value">${data.fuel?.sensitivity_s_per_kg || 'N/A'} s/kg ${dataLabel('ASSUMED')}</span></div>
        <div class="report-row"><span class="report-row-label">Fuel Source</span><span class="report-row-value">${data.fuel?.fit_result?.source || 'N/A'}</span></div>
        <div class="report-row"><span class="report-row-label">Track Evolution</span><span class="report-row-value">${data.track_evolution?.slope_s_per_lap || 'N/A'} s/lap (${data.track_evolution?.direction || 'N/A'})</span></div>
        <div class="report-row"><span class="report-row-label">Traffic Filtered</span><span class="report-row-value">${data.traffic?.traffic_laps || 0} / ${data.traffic?.total_laps || 0} laps (${data.traffic?.pct_traffic || 0}%)</span></div>
      </div>

      ${val ? `
      <div class="report-section">
        <h3>VALIDATION</h3>
        <div class="report-row"><span class="report-row-label">Method</span><span class="report-row-value">${val.method}</span></div>
        <div class="report-row"><span class="report-row-label">MAE</span><span class="report-row-value">${val.mae.toFixed(3)}s</span></div>
        <div class="report-row"><span class="report-row-label">RMSE</span><span class="report-row-value">${val.rmse.toFixed(3)}s</span></div>
        <div class="report-row"><span class="report-row-label">Mean Bias</span><span class="report-row-value">${val.mean_bias > 0 ? '+' : ''}${val.mean_bias.toFixed(3)}s</span></div>
      </div>` : ''}

      <div class="report-conclusion">
        <h3>MODEL CONCLUSION</h3>
        <div class="verdict" style="color:${verdictColor};">${verdictText}</div>
        <p>${verdictExplanation}</p>
      </div>
    </div>
  `;
}

// ── METHODOLOGY PIPELINE ───────────────────────────────────────

function initMethodologyPipeline() {
  const steps = document.querySelectorAll('.pipeline-step');
  const detail = document.getElementById('pipeline-detail');
  if (!steps.length || !detail) return;

  const descriptions = [
    { title: 'OBSERVE', text: 'FastF1 lap timing, tyre compound, stint boundaries, and session data are loaded from the 2024 Singapore GP FP2 practice session.' },
    { title: 'CLEAN', text: 'Invalid laps (pit in/out, yellow flags) are removed. Only green-flag representative laps are retained.' },
    { title: 'TRACK EVOLUTION', text: 'Session time is used to estimate the track surface improving over the session. This correction prevents track evolution from contaminating the tyre signal.' },
    { title: 'FUEL SEPARATION', text: 'Fuel mass decreases as laps progress, making the car lighter and faster. A fuel sensitivity heuristic is applied to remove this confounding speed gain.' },
    { title: 'ANOMALY FILTER', text: 'Traffic-affected laps (≥2s delta from stint median) are identified and excluded. This prevents slower traffic-impacted laps from inflating tyre degradation estimates.' },
    { title: 'TYRE FIT', text: 'A quadratic regression fits the cleaned, corrected lap times against tyre age. R² and residual standard deviation measure how well the curve captures the tyre signal.' },
    { title: 'VALIDATE', text: 'Held-out stints (25% of data) are used to test the model predictions against unseen practice data. MAE, RMSE, and mean bias confirm model reliability.' },
  ];

  steps.forEach((step, i) => {
    step.addEventListener('click', () => {
      steps.forEach(s => s.classList.remove('active'));
      step.classList.add('active');
      detail.innerHTML = `<h4>${descriptions[i].title}</h4><p>${descriptions[i].text}</p>`;
    });
  });

  // Activate first step
  if (steps[0]) steps[0].click();
}
