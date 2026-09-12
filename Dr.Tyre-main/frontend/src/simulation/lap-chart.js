/**
 * lap-chart.js — F1-style Live Position Chart
 */

let lapChartInstance = null;
import { activeCarFilters } from '../main.js';

export function initLapChart() {
  const ctx = document.getElementById('chart-lap-history');
  if (!ctx) return;
  
  if (lapChartInstance) lapChartInstance.destroy();
  
  lapChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 0 // Disable animation for instantaneous updates
      },
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: false // We don't need a legend, the lines have colors
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `Car #${ctx.dataset.label}: P${ctx.raw}`
          }
        }
      },
      scales: {
        x: {
          border: { display: true, color: '#000000', width: 2 },
          title: {
            display: true,
            text: 'Lap',
            color: '#000000'
          },
          grid: {
            tickColor: '#000000',
            color: 'rgba(0,0,0,0.06)'
          },
          ticks: {
            color: '#000000'
          }
        },
        y: {
          reverse: true, // P1 at top, P20 at bottom
          min: 1,
          max: 20,
          border: { display: true, color: '#000000', width: 2 },
          title: {
            display: true,
            text: 'Position',
            color: '#000000'
          },
          grid: {
            tickColor: '#000000',
            color: 'rgba(0,0,0,0.06)'
          },
          ticks: {
            stepSize: 1,
            color: '#000000'
          }
        }
      },
      elements: {
        line: {
          stepped: 'middle', // F1 style step charts
          tension: 0
        },
        point: {
          radius: 0, // Hide points unless hovered
          hoverRadius: 4
        }
      }
    }
  });
}

export function updateLapChart(simState) {
  if (!lapChartInstance || !simState.lapHistory) return;
  
  const currentLaps = Object.keys(simState.lapHistory).map(Number).sort((a,b)=>a-b);
  if (currentLaps.length === 0) return;
  
  const chartData = lapChartInstance.data;
  
  // Update X-axis labels to match the lap numbers we have (including Lap 0 for Grid)
  chartData.labels = currentLaps.map(l => (l === 0 ? 'Grid' : `L${l}`));
  
  // Reinitialize datasets if empty or if car count / IDs changed (e.g. restart / grid change)
  const needsReinit = chartData.datasets.length !== simState.cars.length ||
    (chartData.datasets.length > 0 && chartData.datasets[0].carId !== simState.cars[0]?.id);

  if (needsReinit && simState.cars.length > 0) {
    chartData.datasets = [];
    const teamCounts = {};

    simState.cars.forEach(car => {
      const team = car.team || 'Unknown';
      teamCounts[team] = (teamCounts[team] || 0) + 1;
      const isSecondDriver = teamCounts[team] > 1;

      chartData.datasets.push({
        label: `${car.number}`,
        data: [],
        borderColor: car.color || '#000000',
        backgroundColor: car.color || '#000000',
        carId: car.id,
        carNumber: car.number,
        order: car.isUser ? 0 : 1, // Draw user car on top
        borderWidth: car.isUser ? 3.5 : (isSecondDriver ? 2 : 2),
        borderDash: (!car.isUser && isSecondDriver) ? [5, 4] : [], // Distinguish teammate lines sharing same team color
        pointRadius: 2,
        pointHoverRadius: 6,
        stepped: 'before' // Clean discrete step on lap completion
      });
    });
  }
  
  // Populate data for each car and filter
  chartData.datasets.forEach(dataset => {
    // Check filter
    dataset.hidden = !activeCarFilters.has(dataset.carNumber);

    const carId = dataset.carId;
    
    // Build an array of positions [pos_lap0, pos_lap1, pos_lap2, ...]
    const positions = currentLaps.map(lapNum => {
      return simState.lapHistory[lapNum]?.[carId] ?? null;
    });
    
    dataset.data = positions;
  });
  
  lapChartInstance.update();
}
