/**
 * analysis.js — Analysis Page Orchestrator
 * 
 * Populates the Degradation Analysis tab charts and metrics
 * using data from model_output.json.
 */

import { renderObservedVsGhostBaselineChart, renderDegradationChart, renderValidationChart } from './charts.js';

export function getCompoundColor(compound) {
  const colors = {
    SOFT: '#ff3333',
    MEDIUM: '#ffd700',
    HARD: '#ffffff',
  };
  return colors[compound] || '#888888';
}

export function initAnalysis(modelData) {
  if (!modelData || !modelData.charts) return;

  // 1. Render Charts
  const charts = modelData.charts;
  
  if (charts.observed_vs_ghost) {
    renderObservedVsGhostBaselineChart('chart-raw-corrected', charts.observed_vs_ghost);
  }
  
  if (charts.tyre_induced_pace_loss) {
    renderDegradationChart('chart-degradation', charts.tyre_induced_pace_loss);
  }
  
  if (charts.validation && charts.validation.metrics) {
    renderValidationChart('chart-validation', charts.validation);
    populateValidationMetrics(charts.validation.metrics);
  }
  
  // 2. Populate Model Info Panel
  populateModelInfo(modelData);
}

function populateValidationMetrics(metrics) {
  document.getElementById('metric-mae').textContent = `${metrics.mae.toFixed(3)}s`;
  document.getElementById('metric-rmse').textContent = `${metrics.rmse.toFixed(3)}s`;
  document.getElementById('metric-max-dev').textContent = `${metrics.max_dev.toFixed(3)}s`;
  document.getElementById('metric-bias').textContent = `${metrics.mean_bias > 0 ? '+' : ''}${metrics.mean_bias.toFixed(3)}s`;
  
  document.getElementById('metric-pct-03').textContent = `${metrics['pct_within_0.3s']}%`;
  document.getElementById('metric-pct-05').textContent = `${metrics['pct_within_0.5s']}%`;
  document.getElementById('metric-pct-10').textContent = `${metrics['pct_within_1.0s']}%`;
  
  document.getElementById('metric-n-laps').textContent = metrics.n_laps_validated;
}

function populateModelInfo(data) {
  const grid = document.getElementById('model-info-grid');
  if (!grid) return;
  
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
      <div class="info-card">
        <div class="info-card-title">FUEL SENSITIVITY</div>
        <div class="info-card-value">${data.fuel.sensitivity_s_per_kg} s/kg</div>
        <div class="info-card-detail">${sourceDetail}</div>
      </div>
    `;
  }
  
  // Track Evolution
  if (data.track_evolution) {
    grid.innerHTML += `
      <div class="info-card">
        <div class="info-card-title">TRACK EVOLUTION</div>
        <div class="info-card-value">${data.track_evolution.slope_s_per_lap} s/lap</div>
        <div class="info-card-detail">Total: ${data.track_evolution.total_evolution_s}s (${data.track_evolution.direction})</div>
      </div>
    `;
  }
  
  // Traffic Filter
  if (data.traffic) {
    grid.innerHTML += `
      <div class="info-card">
        <div class="info-card-title">TRAFFIC LAPS EXCLUDED</div>
        <div class="info-card-value">${data.traffic.pct_traffic}%</div>
        <div class="info-card-detail">${data.traffic.traffic_laps} / ${data.traffic.total_laps} laps flagged</div>
      </div>
    `;
  }
  
  // R-squared
  if (data.compounds && data.compounds.MEDIUM) {
    grid.innerHTML += `
      <div class="info-card">
        <div class="info-card-title">MODEL FIT (R²) & SPREAD</div>
        <div class="info-card-value">${data.compounds.MEDIUM.r2_quadratic}</div>
        <div class="info-card-detail">Medium: ResStd ${data.compounds.MEDIUM.residual_std}s</div>
      </div>
    `;
  }
  
  // Untrusted fits warnings
  if (data.compounds) {
    Object.keys(data.compounds).forEach(comp => {
      const c = data.compounds[comp];
      if (c.trusted === false) {
        grid.innerHTML += `
          <div class="info-card" style="border: 1px solid var(--amber);">
            <div class="info-card-title" style="color: var(--amber);">WARNING: ${comp} FIT</div>
            <div class="info-card-value" style="color: var(--amber); font-size: 14px; white-space: normal;">UNTRUSTED</div>
            <div class="info-card-detail" style="color: var(--amber);">${c.note}</div>
          </div>
        `;
      }
    });
  }
}
