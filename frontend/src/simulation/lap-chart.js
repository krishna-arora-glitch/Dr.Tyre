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
          title: {
            display: true,
            text: 'Lap',
            color: 'rgba(255,255,255,0.5)'
          },
          grid: {
            color: 'rgba(255,255,255,0.05)'
          }
        },
        y: {
          reverse: true, // P1 at top, P20 at bottom
          min: 1,
          max: 20,
          title: {
            display: true,
            text: 'Position',
            color: 'rgba(255,255,255,0.5)'
          },
          grid: {
            color: 'rgba(255,255,255,0.05)'
          },
          ticks: {
            stepSize: 1
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
  
  // Update X-axis labels to match the lap numbers we have
  chartData.labels = currentLaps;
  
  // Initialize or filter datasets
  // If datasets are empty, populate them
  if (chartData.datasets.length === 0 && simState.cars.length > 0) {
    simState.cars.forEach(car => {
      chartData.datasets.push({
        label: `${car.number}`,
        data: [],
        borderColor: car.color || '#fff',
        backgroundColor: 'transparent',
        carId: car.id,
        carNumber: car.number,
        order: car.isUser ? 0 : 1, // Draw user car on top
        borderWidth: car.isUser ? 4 : 2, // Highlight user car
      });
    });
  }
  
  // Populate data for each car and filter
  chartData.datasets.forEach(dataset => {
    // Check filter
    dataset.hidden = !activeCarFilters.has(dataset.carNumber);

    const carId = dataset.carId;
    
    // Build an array of positions [pos_lap1, pos_lap2, ...]
    const positions = currentLaps.map(lapNum => {
      return simState.lapHistory[lapNum][carId] || null;
    });
    
    dataset.data = positions;
  });
  
  lapChartInstance.update();
}
