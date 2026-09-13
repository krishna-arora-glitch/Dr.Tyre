/**
 * raceIntelligencePage.js — F1 Pit-Wall Intelligence Feed & Radio Dispatch UI
 *
 * Information Architecture:
 *   RACE INTELLIGENCE
 *     ├── 🚨 RACE ALERTS      → What needs attention RIGHT NOW?
 *     │     ├── Left: Compact Alert Feed (with 📻 RADIO READY badges)
 *     │     └── Right: Diagnostic Deep Dive + Embedded Pit Wall Radio Dispatch (Closable / Collapsible)
 *     └── 📻 PIT WALL RADIO   → Full-screen Radio Dispatch & Transmission History
 *
 * Authoritative hierarchy:
 *   Telemetry Models → Alert / Insight → Strategy Prescription → Radio Dispatch
 *
 * Pure UI layer: strictly does NOT duplicate or replace any backend engines.
 */

import { CATEGORY_COLORS, CATEGORY_BG, AlertStatus } from './alertPriorityEngine.js';

let selectedAlertId = null;
let userExplicitlyClosed = false;
let currentIntelResult = null;
let cachedAlerts = []; // Authoritative module-level cache of current alerts
let activeSelectedAlertObj = null;
let lastRenderedFeedKey = '';
let activeCategoryFilter = 'ALL';
let currentLapNum = 1;
let totalLapsNum = 61;
const radioTransmissions = []; // Session log of sent radio calls

let lastToggleTime = 0;
let lastFeedUpdateTime = 0;
let lastRenderedLap = -1;

/**
 * Toggles an alert's diagnostic insight open or closed.
 * When closed, leaves clean blank space on the right.
 * When open, shows root-cause diagnosis + comparative metrics + embedded radio dispatch.
 *
 * @param {string|number} alertId - Target alert ID to inspect / toggle
 */
export function toggleRaceAlertInsight(alertId) {
  if (!alertId) return;

  const allAlerts = cachedAlerts.length > 0 ? cachedAlerts : ((currentIntelResult && currentIntelResult.topAlerts) || []);

  if (selectedAlertId !== null && String(selectedAlertId) === String(alertId)) {
    // Already open -> TOGGLE CLOSE to blank space
    selectedAlertId = null;
    activeSelectedAlertObj = null;
    userExplicitlyClosed = true;
  } else {
    // Open clicked alert insight in that place
    selectedAlertId = alertId;
    userExplicitlyClosed = false;
    activeSelectedAlertObj = allAlerts.find(a => String(a.id) === String(alertId)) || null;
  }

  // Force re-render of feed to reflect OPEN ▼ / INSPECT ▶ badge and border styling
  renderAlertFeed(allAlerts, currentLapNum, totalLapsNum, true);
  // Render or clear the insight panel
  renderDetailPanel(activeSelectedAlertObj);
}

/**
 * Opens a specific alert's diagnostic insight directly.
 * Ensures the insight panel is open and visible.
 *
 * @param {string|number} alertId - Alert ID to open
 */
export function openRaceAlertInsight(alertId) {
  if (!alertId) return;

  const allAlerts = cachedAlerts.length > 0 ? cachedAlerts : ((currentIntelResult && currentIntelResult.topAlerts) || []);
  selectedAlertId = alertId;
  userExplicitlyClosed = false;
  activeSelectedAlertObj = allAlerts.find(a => String(a.id) === String(alertId)) || null;

  renderAlertFeed(allAlerts, currentLapNum, totalLapsNum, true);
  renderDetailPanel(activeSelectedAlertObj);
}

// Expose globally on window for inline handlers & headless testing
if (typeof window !== 'undefined') {
  window.toggleRaceAlertInsight = toggleRaceAlertInsight;
  window.openRaceAlertInsight = openRaceAlertInsight;
}

/**
 * Initializes the Race Intelligence Feed page.
 * Wires filter pills and navigation shortcuts.
 */
export function initRaceIntelligencePage() {
  // Category Filter Pills
  const filterPills = document.querySelectorAll('.intel-filter-pill');
  filterPills.forEach(pill => {
    if (pill.dataset.bound) return;
    pill.dataset.bound = 'true';
    pill.addEventListener('click', () => {
      filterPills.forEach(p => {
        p.classList.remove('active');
        p.style.background = '#fff';
        p.style.color = '#000';
      });
      pill.classList.add('active');
      pill.style.background = '#000';
      pill.style.color = '#fff';

      activeCategoryFilter = pill.dataset.filter || 'ALL';

      const alerts = (currentIntelResult && currentIntelResult.topAlerts) || cachedAlerts || [];
      const filtered = getFilteredAlerts(alerts);
      if (selectedAlertId && !filtered.some(a => String(a.id) === String(selectedAlertId))) {
        selectedAlertId = null;
        activeSelectedAlertObj = null;
      }
      renderAlertFeed(alerts, currentLapNum, totalLapsNum, true);
      renderDetailPanel(activeSelectedAlertObj);
    });
  });

  // Global event delegation for alert card clicks (pointerdown + click for instant response)
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && !document._raceIntelListenersBound) {
    document._raceIntelListenersBound = true;
    ['pointerdown', 'click'].forEach(eventType => {
      document.addEventListener(eventType, (e) => {
        if (!e.target || !e.target.closest) return;
        if (e.target.closest('#btn-close-detail')) return;
        if (e.target.closest('.btn-edit-embedded-radio') || e.target.closest('.btn-transmit-embedded-radio')) return;

        const card = e.target.closest('.intel-alert-card');
        if (card) {
          const id = (typeof card.getAttribute === 'function' ? card.getAttribute('data-alert-id') : null) || card.dataset?.alertId;
          if (id) {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            if (now - lastToggleTime < 250) {
              e.preventDefault?.();
              e.stopPropagation?.();
              return;
            }
            lastToggleTime = now;
            e.preventDefault?.();
            e.stopPropagation?.();
            toggleRaceAlertInsight(id);
          }
        }
      });
    });
  }

  // Race Control Ticker badge shortcut click
  const rcActiveBadge = document.getElementById('rc-intel-active-badge');
  if (rcActiveBadge && !rcActiveBadge.dataset.bound) {
    rcActiveBadge.dataset.bound = 'true';
    rcActiveBadge.style.cursor = 'pointer';
    rcActiveBadge.addEventListener('click', () => {
      const storyNavTab = document.getElementById('tab-story');
      if (storyNavTab) storyNavTab.click();
    });
  }

  // Header notification badge shortcut: Takes user to Race Intelligence and opens that specific alert!
  const rcHeaderAlert = document.getElementById('rc-header-intel-alert');
  if (rcHeaderAlert && !rcHeaderAlert.dataset.bound) {
    rcHeaderAlert.dataset.bound = 'true';
    const handleHeaderAlertClick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const targetId = rcHeaderAlert.dataset.alertId;
      const storyNavTab = document.getElementById('tab-story');
      if (storyNavTab) storyNavTab.click();
      if (targetId) {
        openRaceAlertInsight(targetId);
      }
    };
    rcHeaderAlert.onclick = handleHeaderAlertClick;
    rcHeaderAlert.addEventListener('click', handleHeaderAlertClick);
  }
}

/**
 * Updates the Race Intelligence Feed UI with new alert data.
 * Called on each lap-crossing from simulation.js.
 *
 * @param {Object} intelResult - Result from evaluateRaceIntelligence()
 * @param {number} currentLap - Current race lap
 * @param {number} totalLaps - Total race laps
 */
export function updateRaceIntelligenceUI(intelResult, currentLap, totalLaps) {
  currentIntelResult = intelResult;
  currentLapNum = currentLap;
  totalLapsNum = totalLaps;

  const alerts = (intelResult && intelResult.topAlerts) || (Array.isArray(intelResult) ? intelResult : []);
  if (alerts && alerts.length > 0) {
    cachedAlerts = alerts;
  }

  // Update active selected alert object with latest telemetry if available
  if (selectedAlertId !== null) {
    const found = cachedAlerts.find(a => String(a.id) === String(selectedAlertId));
    if (found) {
      activeSelectedAlertObj = found;
    }
  } else {
    activeSelectedAlertObj = null;
  }

  // Throttle DOM updates to avoid cancelling click events during live simulation
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (currentLap !== lastRenderedLap || (now - lastFeedUpdateTime >= 350)) {
    lastFeedUpdateTime = now;
    lastRenderedLap = currentLap;
    renderAlertFeed(cachedAlerts, currentLap, totalLaps);
    renderDetailPanel(activeSelectedAlertObj);
  }

  // Update compact feed inside Race Control panel
  renderRaceControlCompactFeed(cachedAlerts);

  // Update Race Control HUD badge ticker
  if (intelResult) updateHUDBadge(intelResult);

  // Update learning log in collapsed section
  if (intelResult?.learningLog) renderLearningLog(intelResult.learningLog);
}

// ════════════════════════════════════════════════════════════════════
// 1. RACE ALERTS FEED RENDERER (WHAT NEEDS ATTENTION RIGHT NOW?)
// ════════════════════════════════════════════════════════════════════

function renderAlertFeed(topAlerts, currentLap, totalLaps, forceReRender = false) {
  const container = document.getElementById('race-alerts-list');
  if (!container) return;

  if (topAlerts && Array.isArray(topAlerts) && topAlerts.length > 0) {
    cachedAlerts = topAlerts;
  }
  const allAlerts = cachedAlerts.length > 0 ? cachedAlerts : (topAlerts || []);

  // Update header lap counter
  const lapEl = document.getElementById('intel-feed-lap-counter');
  if (lapEl) {
    lapEl.innerHTML = `LAP ${currentLap || currentLapNum} / ${totalLaps || totalLapsNum}`;
  }

  // Update filter pill counts (CRITICAL and WARNING errors only)
  const relevantAlerts = (allAlerts || []).filter(a => a.category === 'CRITICAL' || a.category === 'WARNING');
  const cAll = document.getElementById('count-filter-all');
  const cCrit = document.getElementById('count-filter-critical');
  const cWarn = document.getElementById('count-filter-warning');

  if (cAll) cAll.textContent = relevantAlerts.length;
  if (cCrit) cCrit.textContent = relevantAlerts.filter(a => a.category === 'CRITICAL').length;
  if (cWarn) cWarn.textContent = relevantAlerts.filter(a => a.category === 'WARNING').length;

  const filteredAlerts = getFilteredAlerts(allAlerts);

  // Dirty check: if alerts, category filter, and selected alert are identical, do NOT wipe the DOM!
  const feedSignature = `${activeCategoryFilter}_${selectedAlertId}_` + filteredAlerts.map(a => `${a.id}:${a.confidence}`).join('|');
  if (!forceReRender && feedSignature === lastRenderedFeedKey) {
    return; // DOM nodes remain mounted and stable
  }
  lastRenderedFeedKey = feedSignature;

  if (!filteredAlerts || filteredAlerts.length === 0) {
    container.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; border: 2px dashed var(--border-subtle); border-radius: 8px; background: #fff;">
        <div style="font-size: 1.8rem; margin-bottom: 8px;">🏁</div>
        <div style="font-weight: 900; font-size: 0.95rem; color: #000;">NO ${activeCategoryFilter === 'ALL' ? 'ACTIVE' : activeCategoryFilter} ALERTS</div>
        <div style="font-size: 0.78rem; color: #64748b; margin-top: 4px; line-height: 1.4;">
          All telemetry signals nominal within acceptable race degradation tolerances.
        </div>
      </div>`;
    return;
  }

  // Show top 3 to 5 compact alert cards
  container.innerHTML = filteredAlerts.slice(0, 5).map(alert => renderCompactAlertCard(alert)).join('');

  // Wire direct click & pointerdown listeners on each rendered card
  container.querySelectorAll('.intel-alert-card').forEach(card => {
    const handleCardClick = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      const id = (typeof card.getAttribute === 'function' ? card.getAttribute('data-alert-id') : null) || card.dataset?.alertId;
      if (id) toggleRaceAlertInsight(id);
    };
    card.onclick = handleCardClick;
    card.addEventListener('click', handleCardClick);
  });
}

function getFilteredAlerts(alerts) {
  if (!alerts) return [];
  // Filter out OPPORTUNITY and INFORMATION — alert feed focuses on real problems (CRITICAL & WARNING)
  const errorAlerts = alerts.filter(a => a.category === 'CRITICAL' || a.category === 'WARNING');
  if (activeCategoryFilter === 'ALL') return errorAlerts;
  return errorAlerts.filter(a => a.category === activeCategoryFilter);
}

function getSelectedAlert(intelResult) {
  const alerts = (intelResult && intelResult.topAlerts) || cachedAlerts || [];
  if (!selectedAlertId) return null;
  return alerts.find(a => String(a.id) === String(selectedAlertId)) || null;
}

/**
 * Renders a compact, high-contrast alert card.
 * Clearly indicates when a pit wall radio message is attached!
 */
function renderCompactAlertCard(alert) {
  const color = CATEGORY_COLORS[alert.category] || '#2563eb';
  const bg = CATEGORY_BG[alert.category] || 'rgba(37, 99, 235, 0.08)';
  const isSelected = selectedAlertId !== null && String(selectedAlertId) === String(alert.id);

  const categoryEmoji = {
    'CRITICAL': '🔴',
    'WARNING': '🟠',
    'OPPORTUNITY': '🟢',
    'INFORMATION': '🔵'
  }[alert.category] || '⚪';

  const confidenceBg = alert.confidenceLevel === 'HIGH' ? '#dcfce7' : (alert.confidenceLevel === 'MEDIUM' ? '#fef08a' : '#fee2e2');
  const confidenceColor = alert.confidenceLevel === 'HIGH' ? '#166534' : (alert.confidenceLevel === 'MEDIUM' ? '#854d0e' : '#991b1b');

  // Radio call attached badge (Only on alerts with proposed radio)
  const radioBadgeHtml = alert.proposedRadio ? `
    <div style="margin-top: 6px; padding: 4px 8px; background: #000000; border-radius: 4px; display: flex; align-items: center; justify-content: space-between; border-left: 3px solid #fbbf24;">
      <div style="display: flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: 0.65rem; color: #fbbf24; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 78%;">
        <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #22c55e; flex-shrink: 0;"></span>
        📻 RADIO: "${alert.proposedRadio.message}"
      </div>
      <span style="font-size: 0.58rem; font-weight: 900; background: #fbbf24; color: #000; padding: 1px 5px; border-radius: 2px; flex-shrink: 0;">
        ${alert.proposedRadio.type}
      </span>
    </div>
  ` : '';

  return `
    <div class="intel-alert-card ${isSelected ? 'selected' : ''}" data-alert-id="${alert.id}"
      onpointerdown="if (window.toggleRaceAlertInsight) { window.toggleRaceAlertInsight('${alert.id}'); event.stopPropagation(); }"
      onclick="if (window.toggleRaceAlertInsight) { window.toggleRaceAlertInsight('${alert.id}'); event.stopPropagation(); }"
      style="
      background: ${isSelected ? '#ffffff' : bg};
      border: ${isSelected ? '2.5px solid #000000' : '1.5px solid ' + color};
      border-radius: 8px;
      padding: 12px 14px;
      cursor: pointer;
      box-shadow: ${isSelected ? '0 4px 0 #000000' : '0 2px 0 ' + color + '40'};
      transition: all 0.12s ease;
    ">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="
            background: ${color};
            color: #fff;
            font-size: 0.62rem;
            font-weight: 900;
            padding: 2px 8px;
            border-radius: 3px;
            letter-spacing: 0.5px;
          ">${categoryEmoji} ${alert.category}</span>
          ${getStatusBadge(alert.status)}
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="
            font-size: 0.65rem;
            font-weight: 900;
            font-family: var(--font-mono);
            background: ${confidenceBg};
            color: ${confidenceColor};
            padding: 2px 6px;
            border-radius: 3px;
            border: 1px solid ${confidenceColor}40;
          ">${alert.confidence}% ${alert.confidenceLevel}</span>
          ${isSelected ? `
            <span style="font-size: 0.62rem; font-weight: 900; background: #000; color: #fff; padding: 2px 6px; border-radius: 3px;">
              OPEN ▼
            </span>
          ` : `
            <span style="font-size: 0.62rem; font-weight: 800; color: #64748b;">
              INSPECT ▶
            </span>
          `}
        </div>
      </div>

      <div style="font-size: 0.92rem; font-weight: 900; color: #000; line-height: 1.25; margin-bottom: 4px;">
        ${alert.title}
      </div>

      <div style="font-size: 0.78rem; font-weight: 600; color: #334155; line-height: 1.35;">
        ${alert.shortMessage}
      </div>

      ${radioBadgeHtml}
    </div>
  `;
}

// ════════════════════════════════════════════════════════════════════
// 2. SELECTED ALERT DETAIL PANEL (ONLY SHOWN WHEN AN ALERT IS CLICKED)
// ════════════════════════════════════════════════════════════════════

function renderDetailPanel(alert) {
  const panel = document.getElementById('intel-detail-panel');
  const headerLabel = document.getElementById('intel-detail-header-label');
  if (!panel) return;

  // Before clicking an alert or when closed, keep it completely blank space
  if (!alert) {
    panel.innerHTML = '';
    panel.style.display = 'none';
    panel.style.border = 'none';
    panel.style.boxShadow = 'none';
    panel.style.background = 'transparent';
    if (headerLabel) headerLabel.style.display = 'none';
    return;
  }

  // When an alert is clicked, show its insight on that place
  panel.style.display = 'block';
  panel.style.background = '#ffffff';
  panel.style.border = '2px solid var(--color-carbon)';
  panel.style.borderRadius = '8px';
  panel.style.padding = '18px 20px';
  panel.style.boxShadow = '0 4px 0 #000';
  if (headerLabel) headerLabel.style.display = 'block';

  const color = CATEGORY_COLORS[alert.category] || '#2563eb';

  // Extract / synthesize Current vs Expected values cleanly from model state
  const currentVal = extractCurrentMetric(alert);
  const expectedVal = extractExpectedMetric(alert);
  const trendVal = extractTrend(alert);
  const raceObjective = alert.raceObjective || alert.impactIfUnchanged || 'Protect net track position and execute planned single-stop strategy.';

  // Contributors with visual percentage bars
  const factorsHtml = (alert.relatedFactors || []).map(f => {
    const pct = Math.max(0, Math.min(100, f.contribution || 0));
    return `
      <div style="margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; font-size: 0.76rem; font-weight: 700; color: #1e293b; margin-bottom: 3px;">
          <span>${f.factor}</span>
          <span style="font-family: var(--font-mono); font-weight: 900; color: #000;">${pct}%</span>
        </div>
        <div style="height: 6px; background: rgba(0,0,0,0.06); border-radius: 3px; overflow: hidden; border: 1px solid rgba(0,0,0,0.08);">
          <div style="width: ${pct}%; height: 100%; background: ${color};"></div>
        </div>
      </div>
    `;
  }).join('');

  // Embedded Pit Wall Radio Dispatch Section (Only inside alerts with proposed radio)
  let embeddedRadioHtml = '';
  if (alert.proposedRadio) {
    const radioType = alert.proposedRadio.type || 'MANAGEMENT';
    const typeThemes = {
      'MANAGEMENT': { bg: '#fef08a', text: '#854d0e', border: '#ca8a04' },
      'ATTACK': { bg: '#fee2e2', text: '#991b1b', border: '#ef4444' },
      'DEFEND': { bg: '#fed7aa', text: '#9a3412', border: '#f97316' },
      'STRATEGY': { bg: '#000000', text: '#fbbf24', border: '#000000' }
    };
    const cTheme = typeThemes[radioType] || typeThemes.MANAGEMENT;

    embeddedRadioHtml = `
      <div class="embedded-radio-box" style="margin-top: 16px; background: #000000; border: 2px solid #000; border-radius: 8px; padding: 16px; color: #ffffff; box-shadow: 0 4px 0 rgba(0,0,0,0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 8px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 0.85rem;">📻</span>
            <span style="font-size: 0.72rem; font-weight: 900; letter-spacing: 1px; color: #fbbf24;">PIT WALL RADIO DISPATCH</span>
            <span style="font-size: 0.62rem; font-weight: 900; padding: 2px 7px; border-radius: 3px; background: ${cTheme.bg}; color: ${cTheme.text}; border: 1px solid ${cTheme.border};">${radioType}</span>
          </div>
          <span style="font-family: var(--font-mono); font-size: 0.68rem; color: #94a3b8;">CAR #11 · CH 1</span>
        </div>

        <div style="font-size: 0.65rem; font-weight: 800; color: #94a3b8; letter-spacing: 0.5px; margin-bottom: 4px;">
          PROPOSED DRIVER MESSAGE (&lt; 14 WORDS):
        </div>
        <div id="embedded-radio-msg-${alert.id}" style="font-family: var(--font-mono); font-size: 1.25rem; font-weight: 900; line-height: 1.35; color: #ffffff; margin-bottom: 14px; padding: 10px 12px; background: #1e293b; border-left: 4px solid #fbbf24; border-radius: 4px; word-break: break-word;">
          "${alert.proposedRadio.message}"
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap;">
          <span id="embedded-radio-status-${alert.id}" style="font-size: 0.75rem; font-weight: 900; color: #4ade80; display: none;">
            TRANSMITTED TO CAR #11 ✓
          </span>
          <div style="display: flex; gap: 8px; margin-left: auto;">
            <button type="button" class="btn-edit-embedded-radio" data-alert-id="${alert.id}" style="
              padding: 6px 14px; font-size: 0.72rem; font-weight: 900; border: 1.5px solid #64748b;
              background: #334155; color: #fff; cursor: pointer; border-radius: 4px;
            ">✏️ EDIT</button>
            <button type="button" class="btn-transmit-embedded-radio" data-alert-id="${alert.id}" style="
              padding: 6px 18px; font-size: 0.72rem; font-weight: 900; border: 1.5px solid #16a34a;
              background: #16a34a; color: #fff; cursor: pointer; border-radius: 4px;
              box-shadow: 0 2px 0 #15803d;
            ">📻 TRANSMIT TO DRIVER ➔</button>
          </div>
        </div>
      </div>
    `;
  }

  panel.innerHTML = `
    <!-- Header: Viewing banner with explicit CLOSE button -->
    <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 14px;">
      <div>
        <div style="font-size: 0.65rem; font-weight: 900; color: #64748b; letter-spacing: 1px; margin-bottom: 3px;">
          CURRENTLY VIEWING ROOT-CAUSE DIAGNOSIS
        </div>
        <div style="font-size: 1.25rem; font-weight: 900; color: #000; line-height: 1.2;">
          ${alert.title}
        </div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
        <span style="background: ${color}; color: #fff; font-size: 0.65rem; font-weight: 900; padding: 3px 8px; border-radius: 3px;">
          ${alert.category}
        </span>
        ${getStatusBadge(alert.status)}
        <button id="btn-close-detail" type="button" style="
          background: #000000; color: #ffffff; border: 1.5px solid #000000;
          padding: 3px 8px; font-size: 0.65rem; font-weight: 900; border-radius: 4px;
          cursor: pointer; box-shadow: 0 1px 0 rgba(0,0,0,0.5); margin-left: 4px;
        " title="Close insight panel">
          ✕ CLOSE
        </button>
      </div>
    </div>

    <!-- Comparative State Metrics Box: CURRENT vs EXPECTED -->
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px;">
      <div style="background: #f8fafc; border: 1.5px solid #000; border-radius: 6px; padding: 10px 12px;">
        <div style="font-size: 0.65rem; font-weight: 900; color: #64748b; letter-spacing: 0.5px;">CURRENT STATE</div>
        <div style="font-size: 1.15rem; font-weight: 900; font-family: var(--font-mono); color: #dc2626; margin-top: 2px;">
          ${currentVal}
        </div>
      </div>
      <div style="background: #f8fafc; border: 1.5px solid #000; border-radius: 6px; padding: 10px 12px;">
        <div style="font-size: 0.65rem; font-weight: 900; color: #64748b; letter-spacing: 0.5px;">EXPECTED (BASELINE)</div>
        <div style="font-size: 1.15rem; font-weight: 900; font-family: var(--font-mono); color: #166534; margin-top: 2px;">
          ${expectedVal}
        </div>
      </div>
    </div>

    <!-- TREND -->
    <div style="background: rgba(0,0,0,0.02); border-left: 4px solid #000; padding: 8px 12px; margin-bottom: 14px;">
      <div style="font-size: 0.65rem; font-weight: 900; color: #64748b; letter-spacing: 0.5px; margin-bottom: 2px;">TREND</div>
      <div style="font-size: 0.82rem; font-weight: 800; color: #000;">
        ${trendVal}
      </div>
    </div>

    <!-- WHY NOW? -->
    <div style="margin-bottom: 14px;">
      <div style="font-size: 0.70rem; font-weight: 900; color: #000; letter-spacing: 0.5px; margin-bottom: 4px;">WHY NOW?</div>
      <div style="font-size: 0.82rem; color: #1e293b; line-height: 1.45; border-left: 3px solid ${color}; padding-left: 10px;">
        ${alert.whyNow || alert.shortMessage}
      </div>
    </div>

    <!-- PRIMARY CONTRIBUTORS -->
    <div style="margin-bottom: 14px;">
      <div style="font-size: 0.70rem; font-weight: 900; color: #000; letter-spacing: 0.5px; margin-bottom: 8px;">PRIMARY CONTRIBUTORS</div>
      <div style="background: #fafafa; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px;">
        ${factorsHtml || '<div style="font-size:0.75rem; color:#94a3b8;">No single dominant factor identified.</div>'}
      </div>
    </div>

    <!-- IMPACT IF UNCHANGED -->
    <div style="margin-bottom: 14px;">
      <div style="font-size: 0.70rem; font-weight: 900; color: #000; letter-spacing: 0.5px; margin-bottom: 4px;">IMPACT IF UNCHANGED</div>
      <div style="font-size: 0.82rem; color: #dc2626; font-weight: 800; line-height: 1.4; border-left: 3px solid #dc2626; padding-left: 10px;">
        ${alert.impactIfUnchanged || 'Projected pace loss over upcoming stint laps.'}
      </div>
    </div>

    <!-- RACE OBJECTIVE -->
    <div style="margin-bottom: 14px; padding: 10px 12px; background: #f1f5f9; border-radius: 6px; border: 1px solid #cbd5e1;">
      <div style="font-size: 0.65rem; font-weight: 900; color: #475569; letter-spacing: 0.5px; margin-bottom: 3px;">RACE OBJECTIVE</div>
      <div style="font-size: 0.80rem; font-weight: 800; color: #0f172a; line-height: 1.35;">
        ${raceObjective}
      </div>
    </div>

    <!-- PREDICTION CONFIDENCE -->
    <div style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; background: #f8fafc; border: 1.5px solid #000; border-radius: 6px;">
      <span style="font-size: 0.70rem; font-weight: 900; color: #000;">CONFIDENCE ENGINE RATING:</span>
      <span style="font-size: 0.88rem; font-weight: 900; font-family: var(--font-mono); color: ${alert.confidenceLevel === 'HIGH' ? '#166534' : (alert.confidenceLevel === 'MEDIUM' ? '#854d0e' : '#991b1b')};">
        ${alert.confidence}% ${alert.confidenceLevel}
      </span>
    </div>

    <!-- AUTHORITATIVE PRESCRIPTION (STAYS ABOVE RADIO) -->
    <div style="margin-bottom: 14px; padding: 12px 14px; background: #f0fdf4; border: 2px solid #16a34a; border-radius: 6px; box-shadow: 0 2px 0 #16a34a;">
      <div style="font-size: 0.68rem; font-weight: 900; color: #166534; letter-spacing: 1px; margin-bottom: 4px;">
        AUTHORITATIVE STRATEGY PRESCRIPTION
      </div>
      <div style="font-size: 1.05rem; font-weight: 900; color: #000; line-height: 1.3;">
        ${alert.recommendation || 'MONITOR TELEMETRY & MAINTAIN TARGET WINDOW'}
      </div>
    </div>

    <!-- Embedded Pit Wall Radio Dispatch Module (Directly accessible inside the alert) -->
    ${embeddedRadioHtml}
  `;

  // Wire close button
  const btnClose = panel.querySelector('#btn-close-detail');
  if (btnClose) {
    const handleClose = (e) => {
      e?.preventDefault?.();
      e?.stopPropagation?.();
      selectedAlertId = null;
      activeSelectedAlertObj = null;
      userExplicitlyClosed = true;
      renderAlertFeed(cachedAlerts, currentLapNum, totalLapsNum, true);
      renderDetailPanel(null);
    };
    btnClose.onclick = handleClose;
    btnClose.addEventListener('click', handleClose);
    btnClose.addEventListener('pointerdown', handleClose);
  }

  // Wire embedded radio edit & transmit actions
  if (alert.proposedRadio) {
    const btnEmbeddedEdit = panel.querySelector('.btn-edit-embedded-radio');
    const msgEl = panel.querySelector(`#embedded-radio-msg-${alert.id}`);
    if (btnEmbeddedEdit && msgEl) {
      const handleEdit = () => {
        const isEditable = msgEl.contentEditable === 'true' || msgEl.isContentEditable === true;
        if (isEditable) {
          msgEl.contentEditable = 'false';
          msgEl.style.border = 'none';
          msgEl.style.borderLeft = '4px solid #fbbf24';
          msgEl.style.background = '#1e293b';
          btnEmbeddedEdit.textContent = '✏️ EDIT';
        } else {
          msgEl.contentEditable = 'true';
          msgEl.style.border = '2px dashed #fbbf24';
          msgEl.style.background = '#0f172a';
          msgEl.focus();
          btnEmbeddedEdit.textContent = '💾 SAVE';
        }
      };
      btnEmbeddedEdit.onclick = handleEdit;
      btnEmbeddedEdit.addEventListener('click', handleEdit);
    }

    const btnEmbeddedTransmit = panel.querySelector('.btn-transmit-embedded-radio');
    const statusEl = panel.querySelector(`#embedded-radio-status-${alert.id}`);
    if (btnEmbeddedTransmit && msgEl) {
      const handleTransmit = () => {
        const text = msgEl.innerText.trim();
        if (statusEl) {
          statusEl.textContent = `TRANSMITTED TO CAR #11 (LAP ${currentLapNum}) ✓`;
          statusEl.style.display = 'inline-block';
          setTimeout(() => {
            statusEl.style.display = 'none';
          }, 3500);
        }
        recordTransmission(currentLapNum, alert.proposedRadio.type, text);
      };
      btnEmbeddedTransmit.onclick = handleTransmit;
      btnEmbeddedTransmit.addEventListener('click', handleTransmit);
    }
  }
}

function recordTransmission(lap, callType, message) {
  radioTransmissions.unshift({
    lap,
    callType,
    message,
    time: new Date().toLocaleTimeString()
  });
}

// ════════════════════════════════════════════════════════════════════
// 4. RACE CONTROL COMPACT FEED RENDERER
// ════════════════════════════════════════════════════════════════════

export function renderRaceControlCompactFeed(topAlerts) {
  const container = document.getElementById('rc-compact-alerts-list');
  const countBadge = document.getElementById('rc-intel-tab-count');
  // Filter out OPPORTUNITY and INFORMATION — only real threats (CRITICAL and WARNING)
  const errorAlerts = (topAlerts || []).filter(a => a.category === 'CRITICAL' || a.category === 'WARNING');
  if (countBadge) {
    countBadge.textContent = errorAlerts.length;
  }
  if (!container) return;

  if (errorAlerts.length === 0) {
    container.innerHTML = `
      <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 0.72rem; border: 1.5px dashed var(--border-subtle); border-radius: 6px;">
        All telemetry nominal. Monitoring 100+ signals.
      </div>`;
    return;
  }

  container.innerHTML = errorAlerts.slice(0, 4).map(alert => {
    const color = CATEGORY_COLORS[alert.category] || '#2563eb';
    const bg = CATEGORY_BG[alert.category] || 'rgba(37, 99, 235, 0.08)';
    return `
      <div class="rc-compact-alert-card" data-compact-id="${alert.id}" style="
        background: ${bg};
        border: 1.5px solid ${color};
        border-radius: 6px;
        padding: 8px 10px;
        cursor: pointer;
        box-shadow: 0 1px 0 ${color}40;
        transition: transform 0.1s ease;
      " onclick="document.getElementById('tab-story')?.click();" title="Click to view full insight in Race Intelligence Lab">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
          <span style="background: ${color}; color: #fff; font-size: 0.55rem; font-weight: 900; padding: 1px 6px; border-radius: 3px; letter-spacing: 0.5px;">${alert.category}</span>
          <span style="font-size: 0.60rem; font-weight: 800; font-family: var(--font-mono); color: #000;">${alert.confidence}% CONF</span>
        </div>
        <div style="font-size: 0.78rem; font-weight: 900; color: #000; line-height: 1.2; margin-bottom: 2px;">
          ${alert.title}
        </div>
        <div style="font-size: 0.68rem; color: #334155; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          ${alert.shortMessage}
        </div>
        ${alert.proposedRadio ? `
          <div style="margin-top: 4px; padding: 3px 6px; background: #000; border-radius: 3px; font-family: var(--font-mono); font-size: 0.65rem; color: #fbbf24; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
            📻 "${alert.proposedRadio.message}"
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// ════════════════════════════════════════════════════════════════════
// 5. RACE CONTROL TICKER / HUD BADGE
// ════════════════════════════════════════════════════════════════════

function updateHUDBadge(intelResult) {
  const countBadge = document.getElementById('rc-intel-tab-count');
  const activeBadge = document.getElementById('rc-intel-active-badge');
  const topAlerts = intelResult.topAlerts || [];

  const crit = topAlerts.filter(a => a.category === 'CRITICAL');
  const warn = topAlerts.filter(a => a.category === 'WARNING');
  const totalErrors = crit.length + warn.length;

  if (countBadge) {
    countBadge.textContent = totalErrors;
  }

  if (activeBadge) {
    if (totalErrors > 0) {
      const parts = [];
      if (crit.length > 0) parts.push(`🚨 ${crit.length} CRIT`);
      if (warn.length > 0) parts.push(`🟠 ${warn.length} WARN`);
      activeBadge.textContent = parts.join(' | ');
      activeBadge.style.background = crit.length > 0 ? '#fee2e2' : '#fef3c7';
      activeBadge.style.color = crit.length > 0 ? '#991b1b' : '#92400e';
      activeBadge.style.border = crit.length > 0 ? '1px solid #ef4444' : '1px solid #f59e0b';
    } else {
      activeBadge.textContent = '✓ ALL CLEAR';
      activeBadge.style.background = '#dcfce7';
      activeBadge.style.color = '#166534';
      activeBadge.style.border = '1px solid #22c55e';
    }
  }

  // Update header notification badge between LIVE TELEMETRY and the lap progress bar
  const headerAlertBadge = document.getElementById('rc-header-intel-alert');
  const headerAlertText = document.getElementById('rc-header-alert-text');
  const headerAlertIcon = document.getElementById('rc-header-alert-icon');

  if (headerAlertBadge && headerAlertText) {
    if (totalErrors > 0) {
      let targetAlert = null;
      let badgeLabel = '';
      let bg = '';
      let color = '';
      let border = '';
      let icon = '';
      const moreSuffix = totalErrors > 1 ? ' (+MORE)' : '';

      if (crit.length > 0) {
        targetAlert = crit[0];
        badgeLabel = `${crit.length} CRITICAL${moreSuffix}`;
        bg = '#fee2e2';
        color = '#991b1b';
        border = '2px solid #ef4444';
        icon = '🔴';
      } else if (warn.length > 0) {
        targetAlert = warn[0];
        badgeLabel = `${warn.length} WARNING${moreSuffix}`;
        bg = '#fef3c7';
        color = '#92400e';
        border = '2px solid #f59e0b';
        icon = '🟠';
      }

      if (targetAlert) {
        headerAlertBadge.style.display = 'flex';
        headerAlertBadge.dataset.alertId = targetAlert.id;
        headerAlertBadge.style.background = bg;
        headerAlertBadge.style.color = color;
        headerAlertBadge.style.border = border;
        headerAlertBadge.title = `${badgeLabel}: ${targetAlert.title} — Click to view in Race Intelligence`;
        if (headerAlertIcon) headerAlertIcon.textContent = icon;
        headerAlertText.textContent = badgeLabel;
        if (targetAlert.category === 'CRITICAL') {
          headerAlertBadge.classList?.add?.('pulse-alert');
        } else {
          headerAlertBadge.classList?.remove?.('pulse-alert');
        }
      }
    } else {
      // Don't show alerts here when no errors!
      headerAlertBadge.style.display = 'none';
      headerAlertBadge.dataset.alertId = '';
      headerAlertText.textContent = '';
      headerAlertBadge.classList?.remove?.('pulse-alert');
    }
  }
}

// ════════════════════════════════════════════════════════════════════
// 6. AFTER-RACE LEARNING LOG (PREDICTION vs ACTUAL)
// ════════════════════════════════════════════════════════════════════

function renderLearningLog(log) {
  const container = document.getElementById('intel-learning-log');
  if (!container) return;

  if (!log || log.length === 0) {
    container.innerHTML = `
      <div style="padding: 12px; text-align: center; color: #94a3b8; font-size: 0.75rem;">
        No completed prediction outcomes logged yet. Laps will record once degradation events resolve or expire.
      </div>`;
    return;
  }

  container.innerHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 0.72rem; border: 1.5px solid #000; background: #fff;">
      <thead>
        <tr style="background: #f1f5f9; border-bottom: 2px solid #000;">
          <th style="padding: 6px 8px; text-align: left; font-weight: 900;">ALERT TYPE</th>
          <th style="padding: 6px 8px; text-align: left; font-weight: 900;">TELEMETRY METRIC</th>
          <th style="padding: 6px 8px; text-align: right; font-weight: 900;">PREDICTED</th>
          <th style="padding: 6px 8px; text-align: right; font-weight: 900;">ACTUAL</th>
          <th style="padding: 6px 8px; text-align: right; font-weight: 900;">RESIDUAL ERROR</th>
          <th style="padding: 6px 8px; text-align: center; font-weight: 900;">LAP</th>
        </tr>
      </thead>
      <tbody>
        ${log.map(entry => `
          <tr style="border-bottom: 1px solid #e2e8f0;">
            <td style="padding: 5px 8px; font-weight: 800; color: #000;">${entry.type}</td>
            <td style="padding: 5px 8px; color: #475569;">${entry.metric}</td>
            <td style="padding: 5px 8px; text-align: right; font-family: var(--font-mono); font-weight: 700;">
              ${typeof entry.predicted === 'boolean' ? (entry.predicted ? 'YES' : 'NO') : (typeof entry.predicted === 'number' ? entry.predicted.toFixed(3) : entry.predicted)}${entry.unit && entry.unit !== 'bool' ? entry.unit : ''}
            </td>
            <td style="padding: 5px 8px; text-align: right; font-family: var(--font-mono); font-weight: 700;">
              ${typeof entry.actual === 'boolean' ? (entry.actual ? 'YES' : 'NO') : (typeof entry.actual === 'number' ? entry.actual.toFixed(3) : entry.actual || '—')}${entry.unit && entry.unit !== 'bool' ? entry.unit : ''}
            </td>
            <td style="padding: 5px 8px; text-align: right; font-family: var(--font-mono); color: ${entry.error < 0.1 ? '#16a34a' : '#dc2626'}; font-weight: 900;">
              ${typeof entry.error === 'number' ? entry.error.toFixed(3) : '—'}
            </td>
            <td style="padding: 5px 8px; text-align: center; font-family: var(--font-mono); font-weight: 700;">${entry.lap}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>`;
}

// ── Helper Utilities ──────────────────────────────────────────────

function getStatusBadge(status) {
  const map = {
    [AlertStatus.NEW]: { bg: '#dbeafe', color: '#1e40af', text: 'NEW' },
    [AlertStatus.ACTIVE]: { bg: '#fef08a', color: '#854d0e', text: 'ACTIVE' },
    [AlertStatus.IMPROVING]: { bg: '#dcfce7', color: '#166534', text: 'IMPROVING' },
    [AlertStatus.RESOLVED]: { bg: '#e2e8f0', color: '#475569', text: 'RESOLVED' },
    [AlertStatus.EXPIRED]: { bg: '#e2e8f0', color: '#94a3b8', text: 'EXPIRED' }
  };
  const s = map[status] || map[AlertStatus.ACTIVE];
  return `<span style="
    font-size: 0.55rem;
    font-weight: 900;
    background: ${s.bg};
    color: ${s.color};
    padding: 1px 6px;
    border-radius: 3px;
    letter-spacing: 0.5px;
  ">${s.text}</span>`;
}

function extractCurrentMetric(alert) {
  if (alert.currentValue) return alert.currentValue;
  if (alert.shortMessage && alert.shortMessage.includes('s/lap')) {
    const match = alert.shortMessage.match(/[+-]?\d+\.\d+\s*s\/lap/);
    if (match) return match[0];
  }
  if (alert.type === 'THERMAL_RISK') return '108°C (HOT)';
  if (alert.type === 'UNDERCUT_OPPORTUNITY') return 'Δ -0.8s gap';
  if (alert.type === 'OVERTAKE_OPPORTUNITY') return 'DRS active (0.6s)';
  return '+0.091 s/lap';
}

function extractExpectedMetric(alert) {
  if (alert.expectedValue) return alert.expectedValue;
  if (alert.type === 'THERMAL_RISK') return '100°C (IN-WINDOW)';
  if (alert.type === 'UNDERCUT_OPPORTUNITY') return '2.5s safe buffer';
  if (alert.type === 'TYRE_CLIFF') return 'Lap 30 cliff';
  return '+0.058 s/lap (LME Prior)';
}

function extractTrend(alert) {
  if (alert.trend) return alert.trend;
  if (alert.type === 'TYRE_DEGRADATION') return 'Accelerating (+0.008 s/lap²) · Thermal penalty active';
  if (alert.type === 'THERMAL_RISK') return 'Rising +2.4°C/lap over sustained heavy braking';
  if (alert.type === 'UNDERCUT_OPPORTUNITY') return 'Pit window open for next 1–2 laps';
  if (alert.type === 'COMPETITOR_THREAT') return 'Gap closing by -0.32 s/lap';
  return 'Stable telemetry trajectory';
}
