/**
 * charts.js — Chart.js Renderers
 * 
 * Functions to configure and render the three main analysis charts:
 * 1. Observed vs Ghost Baseline
 * 2. Estimated Tyre-Induced Pace Loss
 * 3. Held-Out Validation
 */

import { getCompoundColor } from './analysis.js';

// Chart.js defaults
Chart.defaults.color = 'rgba(232, 234, 237, 0.6)';
Chart.defaults.font.family = "'JetBrains Mono', monospace";
Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(12, 14, 24, 0.9)';
Chart.defaults.plugins.tooltip.titleColor = '#fff';
Chart.defaults.plugins.tooltip.bodyColor = '#00e5ff';
Chart.defaults.plugins.tooltip.borderColor = 'rgba(0, 229, 255, 0.3)';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 4;
Chart.defaults.scale.grid.color = 'rgba(255, 255, 255, 0.05)';
Chart.defaults.scale.grid.zeroLineColor = 'rgba(255, 255, 255, 0.15)';

let charts = {};

export function renderObservedVsGhostBaselineChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !data) return null;

  if (charts[canvasId]) charts[canvasId].destroy();

  // Prepare datasets
  const datasets = [];
  
  // We'll just show MEDIUM compound for clarity
  if (data.MEDIUM) {
    datasets.push({
      label: 'Observed Practice Lap Times',
      data: data.MEDIUM.observed,
      borderColor: 'rgba(255, 255, 255, 0.3)',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [4, 4],
      pointRadius: 3,
      tension: 0.3,
      order: 2,
    });
    
    datasets.push({
      label: 'Estimated Counterfactual Ghost Baseline',
      data: data.MEDIUM.ghost_baseline,
      borderColor: '#00e5ff',
      backgroundColor: 'rgba(0, 229, 255, 0.1)',
      borderWidth: 3,
      pointRadius: 4,
      pointBackgroundColor: '#00e5ff',
      tension: 0.3,
      fill: true,
      order: 1,
    });
  }

  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.MEDIUM ? data.MEDIUM.ages : [],
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: { usePointStyle: true, boxWidth: 8, padding: 20 }
        },
        annotation: {
          annotations: {
            fuelGap: {
              type: 'label',
              xValue: 5,
              yValue: data.MEDIUM ? (data.MEDIUM.observed[4] + data.MEDIUM.ghost_baseline[4]) / 2 : 0,
              backgroundColor: 'rgba(0, 229, 255, 0.15)',
              content: ['Fuel Effect'],
              font: { size: 10 },
              color: '#00e5ff',
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Tyre Age (Laps)', color: 'rgba(255,255,255,0.4)' }
        },
        y: {
          title: { display: true, text: 'Lap Time (s)', color: 'rgba(255,255,255,0.4)' },
          ticks: { callback: (val) => val.toFixed(1) + 's' }
        }
      }
    }
  });

  return charts[canvasId];
}

export function renderDegradationChart(canvasId, curvesData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !curvesData) return null;

  if (charts[canvasId]) charts[canvasId].destroy();

  const datasets = [];
  
  // Add curve and scatter for each compound
  const order = ['SOFT', 'MEDIUM', 'HARD'];
  
  order.forEach(compound => {
    if (!curvesData[compound]) return;
    const cData = curvesData[compound];
    const color = getCompoundColor(compound);
    
    const isTrusted = cData.trusted ?? true;
    const labelSuffix = isTrusted ? 'Fitted' : 'Untrusted';
    
    // Fitted curve
    datasets.push({
      label: `${compound} (${labelSuffix})`,
      data: cData.deltas,
      borderColor: color,
      backgroundColor: 'transparent',
      borderWidth: 3,
      borderDash: isTrusted ? [] : [5, 5],
      pointRadius: 0,
      tension: 0.4,
      type: 'line',
      order: 1,
    });
    
    // Scatter points (corrected data)
    // Map scatter ages/deltas to {x,y} objects
    const scatterPoints = cData.scatter_ages.map((age, i) => ({
      x: age,
      y: cData.scatter_deltas[i]
    }));
    
    datasets.push({
      label: `${compound} (Data)`,
      data: scatterPoints,
      backgroundColor: color.replace(')', ', 0.3)').replace('rgb', 'rgba'),
      borderColor: 'transparent',
      pointRadius: 4,
      type: 'scatter',
      order: 2,
    });
  });

  charts[canvasId] = new Chart(ctx, {
    data: {
      labels: curvesData['MEDIUM'] ? curvesData['MEDIUM'].ages : [],
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
          labels: { 
            usePointStyle: true, boxWidth: 8, padding: 15,
            filter: (item) => item.text.includes('Fitted')
          }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: +${ctx.parsed.y.toFixed(3)}s`
          }
        }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'Tyre Age (Laps)' },
          min: 1,
          max: 40,
        },
        y: {
          title: { display: true, text: 'Lap Time Delta (s)' },
          ticks: { callback: (val) => '+' + val.toFixed(1) + 's' }
        }
      }
    }
  });

  return charts[canvasId];
}

export function renderValidationChart(canvasId, valData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !valData) return null;

  if (charts[canvasId]) charts[canvasId].destroy();
  
  // Sort data by lap number for clean lines
  const sortedIndices = valData.lap_numbers.map((val, ind) => {return {ind, val}}).sort((a, b) => {return a.val > b.val ? 1 : a.val == b.val ? 0 : -1;});
  
  const lapNumbers = sortedIndices.map(e => valData.lap_numbers[e.ind]);
  const actual = sortedIndices.map(e => valData.actual[e.ind]);
  const predicted = sortedIndices.map(e => valData.predicted[e.ind]);
  
  // Scatter points color-coded by compound
  const pointColors = sortedIndices.map(e => getCompoundColor(valData.compounds[e.ind]));
  
  const datasets = [
    {
      label: 'Held-Out Practice Laps (Test Set)',
      data: actual,
      borderColor: 'rgba(255, 255, 255, 0.4)',
      backgroundColor: pointColors,
      borderWidth: 1,
      pointRadius: 4,
      pointHoverRadius: 6,
      showLine: false,
      order: 2,
    },
    {
      label: 'Model Prediction',
      data: predicted,
      borderColor: '#00e5ff',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [5, 5],
      pointRadius: 0,
      tension: 0.3,
      type: 'line',
      order: 1,
    }
  ];

  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: lapNumbers,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true } },
        tooltip: {
          callbacks: {
            title: (items) => `Held-Out Lap`,
            label: (ctx) => {
              const base = `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(3)}s`;
              if (ctx.datasetIndex === 0) {
                // Actual point, find original index to get compound/age
                const origIdx = sortedIndices[ctx.dataIndex].ind;
                const comp = valData.compounds[origIdx];
                const age = valData.tyre_ages[origIdx];
                return [base, `Compound: ${comp}, Age: ${age}`];
              }
              return base;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Lap Index' },
        },
        y: {
          title: { display: true, text: 'Lap Time (s)' },
          ticks: { callback: (val) => val.toFixed(1) + 's' }
        }
      }
    }
  });

  return charts[canvasId];
}
