/**
 * research-charts.js — Chart.js renderers for research visualizations
 * 
 * Ghost Baseline overlay, Component breakdown, Compare overlay
 * All using real model_output.json data.
 */

let researchCharts = {};

function destroyChart(id) {
  if (researchCharts[id]) {
    researchCharts[id].destroy();
    delete researchCharts[id];
  }
}

// ── Ghost Baseline Chart ──────────────────────────────────────

export function renderGhostBaselineChart(canvasId, ghostData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !ghostData) return;
  destroyChart(canvasId);

  // Use MEDIUM as primary
  const compound = ghostData.MEDIUM || ghostData.HARD || ghostData.SOFT;
  if (!compound) return;

  const labels = compound.ages;
  const observed = compound.observed;
  const baseline = compound.ghost_baseline;

  // Calculate the tyre-induced pace loss (difference)
  const tyreLoss = observed.map((obs, i) => obs - baseline[i]);

  researchCharts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Observed Lap Time',
          data: observed,
          borderColor: 'rgba(255, 255, 255, 0.8)',
          backgroundColor: 'transparent',
          borderWidth: 2.5,
          pointRadius: 4,
          pointBackgroundColor: '#fff',
          tension: 0.3,
          order: 1,
        },
        {
          label: 'Ghost Baseline (Counterfactual)',
          data: baseline,
          borderColor: '#00e5ff',
          backgroundColor: 'rgba(0, 229, 255, 0.08)',
          borderWidth: 3,
          pointRadius: 4,
          pointBackgroundColor: '#00e5ff',
          tension: 0.3,
          fill: false,
          order: 2,
        },
        {
          label: 'Tyre-Induced Pace Loss (shaded)',
          data: observed,
          borderColor: 'transparent',
          backgroundColor: 'rgba(255, 23, 68, 0.12)',
          borderWidth: 0,
          pointRadius: 0,
          tension: 0.3,
          fill: {
            target: 1,
            above: 'rgba(255, 23, 68, 0.12)',
            below: 'rgba(0, 230, 118, 0.08)',
          },
          order: 3,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true, boxWidth: 8, padding: 15,
            filter: (item) => !item.text.includes('shaded'),
          }
        },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              if (items.length > 0) {
                const idx = items[0].dataIndex;
                const loss = (tyreLoss[idx] * 1000).toFixed(0);
                return `Tyre-Induced: ${loss > 0 ? '+' : ''}${loss}ms`;
              }
            }
          }
        },
        annotation: {
          annotations: {
            label1: {
              type: 'label',
              xValue: labels[Math.floor(labels.length * 0.6)],
              yValue: (observed[Math.floor(labels.length * 0.6)] + baseline[Math.floor(labels.length * 0.6)]) / 2,
              backgroundColor: 'rgba(255, 23, 68, 0.2)',
              borderRadius: 4,
              content: ['TYRE-INDUCED', 'PACE LOSS'],
              font: { size: 9, weight: 'bold' },
              color: '#ff1744',
              padding: 4,
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Tyre Age (Laps)', color: 'rgba(255,255,255,0.4)' },
        },
        y: {
          title: { display: true, text: 'Lap Time (s)', color: 'rgba(255,255,255,0.4)' },
          ticks: { callback: (val) => val.toFixed(1) + 's' },
        }
      }
    }
  });
}

// ── Component Breakdown Bar Chart ─────────────────────────────

export function renderComponentBreakdownChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !data) return;
  destroyChart(canvasId);

  const med = data.compounds?.MEDIUM;
  if (!med) return;

  const fuelEffect = data.fuel?.sensitivity_s_per_kg * data.fuel?.burn_rate_kg_per_lap || 0.062;
  const trackEvol = Math.abs(data.track_evolution?.slope_s_per_lap || 0.01);
  const tyreDeg = med.deg_per_lap_linear;

  researchCharts[canvasId] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Tyre Contribution', 'Fuel Effect', 'Track Evolution'],
      datasets: [{
        data: [tyreDeg, fuelEffect, trackEvol],
        backgroundColor: ['rgba(255, 23, 68, 0.6)', 'rgba(0, 230, 118, 0.6)', 'rgba(0, 229, 255, 0.6)'],
        borderColor: ['#ff1744', '#00e676', '#00e5ff'],
        borderWidth: 1,
        barThickness: 40,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.y.toFixed(4)} s/lap`
          }
        }
      },
      scales: {
        y: {
          title: { display: true, text: 'Effect per Lap (s)', color: 'rgba(255,255,255,0.4)' },
          ticks: { callback: (val) => val.toFixed(3) + 's' },
        }
      }
    }
  });
}

// ── Compare Overlay Chart ─────────────────────────────────────

export function renderCompareOverlayChart(canvasId, paceLossData, compounds) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !paceLossData) return;
  destroyChart(canvasId);

  const compoundColors = { SOFT: '#ff3333', MEDIUM: '#ffd700', HARD: '#ffffff' };
  const datasets = [];

  compounds.forEach(comp => {
    const cData = paceLossData[comp];
    if (!cData) return;

    datasets.push({
      label: `${comp} — Estimated Pace Loss`,
      data: cData.ages.map((age, i) => ({ x: age, y: cData.deltas[i] })),
      borderColor: compoundColors[comp] || '#888',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.4,
    });
  });

  researchCharts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: +${ctx.parsed.y.toFixed(2)}s`
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Tyre Age (Laps)' },
          min: 1,
        },
        y: {
          title: { display: true, text: 'Estimated Pace Loss (s)' },
          ticks: { callback: (val) => '+' + val.toFixed(1) + 's' },
        }
      }
    }
  });
}
