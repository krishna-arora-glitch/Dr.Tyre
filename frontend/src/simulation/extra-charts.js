/**
 * extra-charts.js — Handlers for Fastest Laps, Pit Stops, Weather, Penalties
 */
import { activeCarFilters } from '../main.js';

let fastestLapsChart = null;
let pitStopsChart = null;
let weatherChart = null;

export function initExtraCharts() {
  initFastestLapsChart();
  initPitStopsChart();
  initWeatherChart();
}

function initFastestLapsChart() {
  const ctx = document.getElementById('chart-fastest-laps');
  if (!ctx) return;
  
  if (fastestLapsChart) fastestLapsChart.destroy();
  
  fastestLapsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        label: 'Best Lap (s)',
        data: [],
        backgroundColor: [],
        borderWidth: 1
      }]
    },
    options: {
      indexAxis: 'y', // horizontal bar chart
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.raw.toFixed(3)}s`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Lap Time (s)', color: 'rgba(255,255,255,0.5)' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          // Don't start at 0 for lap times, start near min
        },
        y: {
          grid: { display: false }
        }
      }
    }
  });
}

function initPitStopsChart() {
  const ctx = document.getElementById('chart-pit-stops');
  if (!ctx) return;
  
  if (pitStopsChart) pitStopsChart.destroy();
  
  pitStopsChart = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `Lap ${ctx.raw.x} - ${ctx.dataset.label} (${ctx.raw.compound}): ${ctx.raw.y.toFixed(1)}s`
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Lap', color: 'rgba(255,255,255,0.5)' },
          grid: { color: 'rgba(255,255,255,0.05)' },
          min: 1
        },
        y: {
          title: { display: true, text: 'Stop Duration (s)', color: 'rgba(255,255,255,0.5)' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

function initWeatherChart() {
  const ctx = document.getElementById('chart-weather');
  if (!ctx) return;
  
  if (weatherChart) weatherChart.destroy();
  
  weatherChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Track Temp (°C)',
          data: [],
          borderColor: '#ff8000',
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2
        },
        {
          label: 'Air Temp (°C)',
          data: [],
          borderColor: '#00e5ff',
          backgroundColor: 'transparent',
          tension: 0.3,
          borderWidth: 2,
          borderDash: [5, 5]
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: { display: true, labels: { color: '#fff' } }
      },
      scales: {
        x: {
          title: { display: true, text: 'Lap', color: 'rgba(255,255,255,0.5)' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          title: { display: true, text: 'Temperature (°C)', color: 'rgba(255,255,255,0.5)' },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      }
    }
  });
}

export function updateExtraCharts(simState) {
  if (!simState || !simState.active && simState.lap === 1) return;
  
  updateFastestLaps(simState);
  updatePitStops(simState);
  updateWeather(simState);
  updatePenalties(simState);
}

function updateFastestLaps(simState) {
  if (!fastestLapsChart) return;
  
  // Get all cars with a valid best lap and filter by active cars
  const validCars = simState.cars.filter(c => c.bestLapTime > 0 && activeCarFilters.has(c.number));
  if (validCars.length === 0) {
    fastestLapsChart.data.labels = [];
    fastestLapsChart.data.datasets[0].data = [];
    fastestLapsChart.update();
    return;
  }
  
  // Sort fastest first
  validCars.sort((a, b) => a.bestLapTime - b.bestLapTime);
  
  const labels = validCars.map(c => `#${c.number} ${c.isUser ? '(YOU)' : ''}`);
  const data = validCars.map(c => c.bestLapTime);
  const colors = validCars.map(c => c.color);
  
  fastestLapsChart.data.labels = labels;
  fastestLapsChart.data.datasets[0].data = data;
  fastestLapsChart.data.datasets[0].backgroundColor = colors;
  
  // Adjust min scale slightly below fastest lap for better visibility
  const minLap = data[0];
  fastestLapsChart.options.scales.x.min = Math.floor(minLap) - 1;
  
  fastestLapsChart.update();
}

function updatePitStops(simState) {
  if (!pitStopsChart || !simState.pitHistory) return;
  
  // Group pit stops by car
  const datasets = [];
  
  // Create a dataset for each unique car in the pit history
  const carStops = {};
  simState.pitHistory.forEach(stop => {
    // FILTER: Check if car is active
    if (!activeCarFilters.has(stop.carNumber)) return;
    
    if (!carStops[stop.carNumber]) {
      carStops[stop.carNumber] = { color: stop.color, data: [] };
    }
    carStops[stop.carNumber].data.push({
      x: stop.lap,
      y: stop.duration,
      compound: stop.compound
    });
  });
  
  Object.keys(carStops).forEach(carNum => {
    datasets.push({
      label: `Car #${carNum}`,
      data: carStops[carNum].data,
      backgroundColor: carStops[carNum].color,
      borderColor: '#fff',
      borderWidth: 1,
      pointRadius: 6,
      pointHoverRadius: 8
    });
  });
  
  pitStopsChart.data.datasets = datasets;
  pitStopsChart.update();
}

function updateWeather(simState) {
  if (!weatherChart || !simState.weatherHistory) return;
  
  weatherChart.data.labels = simState.weatherHistory.laps;
  weatherChart.data.datasets[0].data = simState.weatherHistory.trackTemp;
  weatherChart.data.datasets[1].data = simState.weatherHistory.airTemp;
  
  weatherChart.update();
}

function updatePenalties(simState) {
  const tbody = document.getElementById('penalties-tbody');
  if (!tbody || !simState.penalties) return;
  
  if (simState.penalties.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding: 20px;">No penalties awarded yet</td></tr>';
    return;
  }
  
  // Sort latest first
  const sorted = [...simState.penalties].sort((a,b) => b.lap - a.lap);
  
  tbody.innerHTML = sorted.map(p => `
    <tr>
      <td>Lap ${p.lap}</td>
      <td style="font-weight:bold;">#${p.carNumber}</td>
      <td style="color:var(--amber);">${p.type}</td>
      <td>+${p.time}s</td>
    </tr>
  `).join('');
}
