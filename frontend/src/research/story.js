/**
 * story.js — Story Mode Controller
 * 
 * 8-step scientific walkthrough:
 * 1. RAW LAP TIME
 * 2. FUEL MASKING
 * 3. TRACK EVOLUTION
 * 4. TRAFFIC FILTERING
 * 5. GHOST BASELINE
 * 6. TYRE-INDUCED PACE LOSS
 * 7. CONFIDENCE
 * 8. STRATEGY SIMULATION
 */

let currentStep = 1;
const TOTAL_STEPS = 8;

export function initStoryMode(data) {
  if (!data) return;

  const container = document.getElementById('story-content');
  if (!container) return;

  currentStep = 1;
  renderStep(container, data);

  const prevBtn = document.getElementById('story-prev');
  const nextBtn = document.getElementById('story-next');

  if (prevBtn) {
    prevBtn.onclick = () => {
      if (currentStep > 1) { currentStep--; renderStep(container, data); }
    };
  }
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (currentStep < TOTAL_STEPS) {
        currentStep++;
        renderStep(container, data);
      } else {
        // Jump to Race Control tab
        const rcTab = document.getElementById('tab-simulation');
        if (rcTab) rcTab.click();
      }
    };
  }
}

function renderStep(container, data) {
  // Update progress
  const bars = document.querySelectorAll('.story-progress-bar');
  bars.forEach((bar, i) => {
    bar.classList.toggle('filled', i < currentStep);
  });

  // Update buttons
  const prevBtn = document.getElementById('story-prev');
  const nextBtn = document.getElementById('story-next');
  if (prevBtn) prevBtn.disabled = (currentStep === 1);
  if (nextBtn) nextBtn.textContent = (currentStep === TOTAL_STEPS) ? '▶ ENTER RACE CONTROL' : 'Next →';

  const med = data.compounds?.MEDIUM;
  const fuel = data.fuel;
  const track = data.track_evolution;
  const traffic = data.traffic;

  let html = '';

  switch (currentStep) {
    case 1:
      html = `
        <div class="story-step">
          <h1 class="story-title">THE PROBLEM</h1>
          <p class="story-subtitle" style="border-color:var(--red);">Lap time does NOT tell you what the tyre is doing.</p>
          <div class="story-visual-card">
            <h3 style="margin-bottom:24px;color:var(--text-muted);">Raw Lap Times — Singapore GP FP2</h3>
            <div style="font-family:var(--font-mono);font-size:1.1rem;display:flex;flex-direction:column;gap:8px;align-items:center;">
              <div style="color:var(--text-muted);">Lap 5 ..... ${med ? (med.base_pace + med.deg_linear * 5).toFixed(2) : '96.80'}s</div>
              <div style="color:var(--text-muted);">Lap 8 ..... ${med ? (med.base_pace + med.deg_linear * 8).toFixed(2) : '96.75'}s</div>
              <div style="color:var(--text-primary);font-weight:bold;font-size:1.3rem;">Lap 11 .... ${med ? (med.base_pace + med.deg_linear * 11).toFixed(2) : '96.70'}s</div>
              <div style="color:var(--text-muted);">Lap 14 .... ${med ? (med.base_pace + med.deg_linear * 14).toFixed(2) : '96.82'}s</div>
            </div>
            <div style="margin-top:32px;">
              <span style="background:rgba(255,255,255,0.06);border:1px solid var(--border-medium);border-radius:20px;padding:8px 20px;font-weight:bold;">Looks stable.</span>
            </div>
            <div style="margin-top:24px;color:var(--red);font-weight:bold;font-size:1rem;letter-spacing:2px;">
              But the tyre may still be losing performance.
            </div>
            <p style="color:var(--text-secondary);font-size:0.82rem;margin-top:8px;">Fuel burn pace gains can mask tyre degradation.</p>
          </div>
        </div>`;
      break;

    case 2:
      html = `
        <div class="story-step">
          <h1 class="story-title">FUEL MASKING</h1>
          <p class="story-subtitle" style="border-color:#58a6ff;">Raw lap time is a mixture of opposing effects.</p>
          <div class="story-visual-card">
            <div style="text-align:center;margin-bottom:24px;">
              <span style="background:rgba(255,255,255,0.06);border:2px solid var(--text-primary);border-radius:8px;padding:12px 24px;font-size:1.3rem;font-weight:bold;letter-spacing:2px;">OBSERVED LAP TIME</span>
            </div>
            <div style="text-align:center;font-size:1.2rem;color:var(--text-muted);margin:8px 0;">=</div>
            <div style="max-width:400px;margin:0 auto;">
              <div class="decomp-block" style="border-left:4px solid var(--amber);">
                <span style="font-weight:bold;font-size:0.95rem;">Fuel Burn</span>
                <span style="color:var(--green);font-family:var(--font-mono);font-size:0.82rem;">− ${fuel ? (fuel.sensitivity_s_per_kg * fuel.burn_rate_kg_per_lap).toFixed(3) : '0.062'} s/lap</span>
              </div>
              <div style="text-align:center;color:var(--text-muted);font-weight:bold;">+</div>
              <div class="decomp-block" style="border-left:4px solid var(--red);">
                <span style="font-weight:bold;font-size:0.95rem;">Tyre Contribution</span>
                <span style="color:var(--red);font-family:var(--font-mono);font-size:0.82rem;">+ ${med ? med.deg_per_lap_linear.toFixed(3) : '0.527'} s/lap</span>
              </div>
              <div style="text-align:center;color:var(--text-muted);font-weight:bold;">+</div>
              <div class="decomp-block" style="border-left:4px solid var(--cyan);">
                <span style="font-weight:bold;font-size:0.95rem;">Track Evolution & Traffic</span>
                <span style="color:var(--text-muted);font-family:var(--font-mono);font-size:0.82rem;">noise</span>
              </div>
            </div>
            <div style="margin-top:24px;color:#58a6ff;font-weight:bold;font-size:1.1rem;">
              Our pipeline isolates the tyre contribution.
            </div>
          </div>
        </div>`;
      break;

    case 3:
      html = `
        <div class="story-step">
          <h1 class="story-title">TRACK EVOLUTION</h1>
          <p class="story-subtitle" style="border-color:var(--cyan);">The track surface improves during the session.</p>
          <div class="story-visual-card">
            <div class="metric-grid" style="max-width:500px;margin:0 auto;">
              <div class="metric-card">
                <div class="metric-card-label">TRACK EVOLUTION</div>
                <div class="metric-card-value">${track ? track.slope_s_per_lap : 'N/A'}</div>
                <div class="metric-card-unit">s/lap</div>
                <div class="metric-card-sublabel">${track ? track.direction : 'N/A'}</div>
              </div>
              <div class="metric-card">
                <div class="metric-card-label">TOTAL SESSION EFFECT</div>
                <div class="metric-card-value">${track ? track.total_evolution_s : 'N/A'}</div>
                <div class="metric-card-unit">seconds</div>
              </div>
            </div>
            <div class="why-it-matters" style="margin-top:24px;text-align:left;">
              <div class="why-it-matters-header"><span>💡</span><h4>Why It Matters</h4></div>
              <p>As rubber is laid down on the track, it becomes faster. Without correcting for this, the track improvement could mask some of the tyre degradation signal.</p>
            </div>
          </div>
        </div>`;
      break;

    case 4:
      html = `
        <div class="story-step">
          <h1 class="story-title">TRAFFIC FILTERING</h1>
          <p class="story-subtitle" style="border-color:var(--amber);">Anomalous laps are identified and removed.</p>
          <div class="story-visual-card">
            <div class="metric-grid" style="max-width:500px;margin:0 auto;">
              <div class="metric-card">
                <div class="metric-card-label">TOTAL LAPS</div>
                <div class="metric-card-value">${traffic ? traffic.total_laps : 'N/A'}</div>
              </div>
              <div class="metric-card">
                <div class="metric-card-label">TRAFFIC LAPS</div>
                <div class="metric-card-value" style="color:var(--amber);">${traffic ? traffic.traffic_laps : 'N/A'}</div>
                <div class="metric-card-sublabel">${traffic ? traffic.pct_traffic : 'N/A'}% removed</div>
              </div>
              <div class="metric-card">
                <div class="metric-card-label">MEAN TRAFFIC DELTA</div>
                <div class="metric-card-value">${traffic ? traffic.mean_traffic_delta_s.toFixed(1) : 'N/A'}</div>
                <div class="metric-card-unit">seconds slower</div>
              </div>
            </div>
            <div class="why-it-matters" style="margin-top:24px;text-align:left;">
              <div class="why-it-matters-header"><span>💡</span><h4>Why It Matters</h4></div>
              <p>Traffic-affected laps are significantly slower for reasons unrelated to tyre performance. Including them would inflate the estimated degradation rate.</p>
            </div>
          </div>
        </div>`;
      break;

    case 5:
      html = `
        <div class="story-step">
          <h1 class="story-title">THE GHOST BASELINE</h1>
          <p class="story-subtitle" style="border-color:var(--cyan);">Peeling back the layers to reveal tyre performance.</p>
          <div class="story-visual-card" style="text-align:left;">
            <div style="height:300px;"><canvas id="story-ghost-chart"></canvas></div>
          </div>
          <div class="why-it-matters">
            <div class="why-it-matters-header"><span>💡</span><h4>Why It Matters</h4></div>
            <p>The Ghost Baseline is the model-estimated counterfactual: what the lap time <em>would have been</em> without tyre degradation. The gap between observed and ghost baseline is the estimated tyre-induced pace loss.</p>
          </div>
        </div>`;
      break;

    case 6:
      html = `
        <div class="story-step">
          <h1 class="story-title">TYRE-INDUCED PACE LOSS</h1>
          <p class="story-subtitle" style="border-color:var(--red);">The extracted degradation signal.</p>
          <div class="story-visual-card">
            <div class="metric-grid" style="max-width:600px;margin:0 auto;">
              <div class="metric-card" style="border-left:3px solid #ff3333;">
                <div class="metric-card-label">SOFT</div>
                <div class="metric-card-value">+${data.compounds.SOFT ? data.compounds.SOFT.deg_per_lap_linear.toFixed(3) : 'N/A'}</div>
                <div class="metric-card-unit">s/lap</div>
              </div>
              <div class="metric-card" style="border-left:3px solid #ffd700;">
                <div class="metric-card-label">MEDIUM</div>
                <div class="metric-card-value">+${med ? med.deg_per_lap_linear.toFixed(3) : 'N/A'}</div>
                <div class="metric-card-unit">s/lap</div>
              </div>
              <div class="metric-card" style="border-left:3px solid #ffffff;">
                <div class="metric-card-label">HARD</div>
                <div class="metric-card-value">+${data.compounds.HARD ? data.compounds.HARD.deg_per_lap_linear.toFixed(3) : 'N/A'}</div>
                <div class="metric-card-unit">s/lap</div>
              </div>
            </div>
          </div>
        </div>`;
      break;

    case 7:
      html = `
        <div class="story-step">
          <h1 class="story-title">CONFIDENCE</h1>
          <p class="story-subtitle" style="border-color:var(--green);">Can we trust this estimate?</p>
          <div class="story-visual-card">
            <div class="metric-grid" style="max-width:600px;margin:0 auto;">
              <div class="metric-card">
                <div class="metric-card-label">R² (MEDIUM)</div>
                <div class="metric-card-value">${med ? med.r2_quadratic.toFixed(4) : 'N/A'}</div>
                <div class="metric-card-sublabel">${med && med.r2_quadratic >= 0.5 ? 'Strong fit' : 'Moderate fit'}</div>
              </div>
              <div class="metric-card">
                <div class="metric-card-label">CLEAN LAPS</div>
                <div class="metric-card-value">${med ? med.n_laps : 'N/A'}</div>
              </div>
              <div class="metric-card">
                <div class="metric-card-label">VALIDATION MAE</div>
                <div class="metric-card-value">${data.charts?.validation?.metrics ? data.charts.validation.metrics.mae.toFixed(3) : 'N/A'}</div>
                <div class="metric-card-unit">seconds</div>
              </div>
              <div class="metric-card">
                <div class="metric-card-label">FIT STATUS</div>
                <div class="metric-card-value" style="font-size:1rem;">${med && med.r2_quadratic >= 0.5 ? '<span style="color:var(--green);">TRUSTED</span>' : '<span style="color:var(--amber);">INDICATIVE</span>'}</div>
              </div>
            </div>
          </div>
          <div class="why-it-matters">
            <div class="why-it-matters-header"><span>💡</span><h4>Why It Matters</h4></div>
            <p>A weak R² means the estimated degradation slope should not be treated as a reliable finding. Only trusted fits are used in strategy decisions.</p>
          </div>
        </div>`;
      break;

    case 8:
      html = `
        <div class="story-step">
          <h1 class="story-title">STRATEGY SIMULATION</h1>
          <p class="story-subtitle" style="border-color:var(--green);">From research to race-day decisions.</p>
          <div class="story-visual-card">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:600px;margin:0 auto;text-align:left;">
              <div style="display:flex;align-items:flex-start;gap:12px;">
                <span style="font-size:1.5rem;color:var(--cyan);">1</span>
                <div>
                  <h3 style="font-size:0.95rem;font-weight:bold;">Removed confounders</h3>
                  <p style="font-size:0.78rem;color:var(--text-secondary);margin-top:4px;">Fuel burn and track evolution isolated from the tyre signal.</p>
                </div>
              </div>
              <div style="display:flex;align-items:flex-start;gap:12px;">
                <span style="font-size:1.5rem;color:var(--cyan);">2</span>
                <div>
                  <h3 style="font-size:0.95rem;font-weight:bold;">Estimated pace loss</h3>
                  <p style="font-size:0.78rem;color:var(--text-secondary);margin-top:4px;">Quantified tyre contribution to lap time per compound.</p>
                </div>
              </div>
              <div style="display:flex;align-items:flex-start;gap:12px;">
                <span style="font-size:1.5rem;color:var(--cyan);">3</span>
                <div>
                  <h3 style="font-size:0.95rem;font-weight:bold;">Validated estimate</h3>
                  <p style="font-size:0.78rem;color:var(--text-secondary);margin-top:4px;">Held-out stint validation confirms model reliability.</p>
                </div>
              </div>
              <div style="display:flex;align-items:flex-start;gap:12px;">
                <span style="font-size:1.5rem;color:var(--cyan);">4</span>
                <div>
                  <h3 style="font-size:0.95rem;font-weight:bold;">Counterfactual simulation</h3>
                  <p style="font-size:0.78rem;color:var(--text-secondary);margin-top:4px;">Race Control uses these estimates to simulate optimal pit strategy.</p>
                </div>
              </div>
            </div>
            <div style="margin-top:32px;padding:16px;background:rgba(88,166,255,0.08);border:1px solid rgba(88,166,255,0.2);border-radius:8px;max-width:500px;margin-left:auto;margin-right:auto;">
              <p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:8px;">Instead of asking:</p>
              <p style="font-size:1rem;color:var(--text-primary);font-style:italic;margin-bottom:16px;">"Why did the lap time change?"</p>
              <div style="width:40px;height:2px;background:var(--cyan);margin:0 auto 16px;"></div>
              <p style="font-size:0.9rem;color:var(--text-secondary);margin-bottom:8px;">We ask:</p>
              <p style="font-size:1.1rem;font-weight:bold;color:#58a6ff;">"How much of that change can be attributed to the tyre?"</p>
            </div>
          </div>
        </div>`;
      break;
  }

  container.innerHTML = html;

  // Render ghost chart on step 5
  if (currentStep === 5 && data.charts?.observed_vs_ghost) {
    setTimeout(() => {
      renderStoryGhostChart('story-ghost-chart', data.charts.observed_vs_ghost);
    }, 100);
  }
}

// Inline mini ghost chart for story mode (avoid circular import)
function renderStoryGhostChart(canvasId, ghostData) {
  const ctx = document.getElementById(canvasId);
  if (!ctx || !ghostData) return;

  const compound = ghostData.MEDIUM || ghostData.HARD;
  if (!compound) return;

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: compound.ages,
      datasets: [
        {
          label: 'Observed',
          data: compound.observed,
          borderColor: 'rgba(255,255,255,0.7)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#fff',
          tension: 0.3,
        },
        {
          label: 'Ghost Baseline',
          data: compound.ghost_baseline,
          borderColor: '#00e5ff',
          borderWidth: 2.5,
          pointRadius: 3,
          pointBackgroundColor: '#00e5ff',
          tension: 0.3,
        },
        {
          label: 'Tyre Loss',
          data: compound.observed,
          borderColor: 'transparent',
          fill: { target: 1, above: 'rgba(255,23,68,0.15)' },
          pointRadius: 0,
          tension: 0.3,
        },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { usePointStyle: true, boxWidth: 6, filter: i => !i.text.includes('Loss') } },
      },
      scales: {
        x: { title: { display: true, text: 'Tyre Age (Laps)' } },
        y: { title: { display: true, text: 'Lap Time (s)' }, ticks: { callback: v => v.toFixed(1) + 's' } },
      }
    }
  });
}

