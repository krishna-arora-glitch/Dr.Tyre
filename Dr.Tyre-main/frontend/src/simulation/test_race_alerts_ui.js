/**
 * test_race_alerts_ui.js
 * Headless test for Race Alerts UI, Detail Panel, and Pit Wall Radio views.
 */

import assert from 'assert';
import {
  initRaceIntelligencePage,
  updateRaceIntelligenceUI,
  renderRaceControlCompactFeed
} from './raceIntelligencePage.js';
import { AlertCategory, AlertStatus, RadioCallType } from './alertPriorityEngine.js';

console.log('🏁 Starting Race Alerts UI & Pit Wall Radio Test Suite...\n');

let passedTests = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ FAIL: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// Minimal Mock DOM for Headless Node Testing
class MockElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.style = {};
    this.classList = new Set();
    this.classList.remove = (c) => this.classList.delete(c);
    this.dataset = {};
    this.children = [];
    this._innerHTML = '';
    this._textContent = '';
    this.contentEditable = 'false';
    this.eventListeners = {};
  }

  get isContentEditable() {
    return this.contentEditable === 'true';
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(val) {
    this._innerHTML = val;
    this.children = [];
    this._queriedMap = {};
    const idMatches = [...val.matchAll(/data-alert-id="([^"]*)"/g)];
    for (const m of idMatches) {
      const child = new MockElement();
      child.dataset.alertId = m[1];
      child.classList.add('intel-alert-card');
      this.children.push(child);
    }
  }

  get textContent() {
    return this._textContent || this._innerHTML.replace(/<[^>]*>/g, '').trim();
  }

  set textContent(val) {
    this._textContent = val;
    this._innerHTML = val;
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(val) {
    this.textContent = val;
  }

  addEventListener(type, handler) {
    if (!this.eventListeners[type]) this.eventListeners[type] = [];
    this.eventListeners[type].push(handler);
  }

  click() {
    if (this.onclick) {
      this.onclick({ target: this, stopPropagation: () => {} });
    } else if (this.eventListeners['click']) {
      for (const h of this.eventListeners['click']) {
        h({ target: this, stopPropagation: () => {} });
      }
    }
  }

  focus() {
    this.isFocused = true;
  }

  querySelector(sel) {
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return getOrCreateElem(id);
    }
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (!this._queriedMap) this._queriedMap = {};
      if (!this._queriedMap[cls]) {
        const elem = new MockElement();
        elem.classList.add(cls);
        this._queriedMap[cls] = elem;
      }
      return this._queriedMap[cls];
    }
    return new MockElement();
  }

  querySelectorAll(sel) {
    if (sel === '.intel-filter-pill') {
      return global.mockFilterPills || [];
    }
    if (sel === '.intel-alert-card') {
      return this.children.filter(c => c.classList.has('intel-alert-card'));
    }
    return [];
  }
}

const elementsMap = {};
function getOrCreateElem(id, tagName = 'div') {
  if (!elementsMap[id]) {
    elementsMap[id] = new MockElement(id, tagName);
  }
  return elementsMap[id];
}

// Setup Global Mock Document
global.document = {
  getElementById: (id) => getOrCreateElem(id),
  querySelectorAll: (sel) => {
    if (sel === '.intel-filter-pill') return global.mockFilterPills || [];
    return [];
  },
  addEventListener: () => {}
};

// Create filter pill elements
global.mockFilterPills = [
  new MockElement('pill-all'),
  new MockElement('pill-critical'),
  new MockElement('pill-warning'),
  new MockElement('pill-opp'),
  new MockElement('pill-info')
];
global.mockFilterPills[0].dataset.filter = 'ALL';
global.mockFilterPills[1].dataset.filter = 'CRITICAL';
global.mockFilterPills[2].dataset.filter = 'WARNING';
global.mockFilterPills[3].dataset.filter = 'OPPORTUNITY';
global.mockFilterPills[4].dataset.filter = 'INFORMATION';

// Mock sample alerts
const mockAlerts = [
  {
    id: 'alert_thermal_fr',
    type: 'THERMAL_RISK',
    category: 'CRITICAL',
    title: 'FRONT-RIGHT THERMAL DEGRADATION',
    shortMessage: 'Projected +0.40s over next 2 laps (108°C HOT)',
    confidence: 87,
    confidenceLevel: 'HIGH',
    urgency: 85,
    severity: 85,
    status: AlertStatus.ACTIVE,
    currentValue: '+0.091 s/lap (108°C)',
    expectedValue: '+0.058 s/lap (100°C Window)',
    trend: 'Rising +2.4°C/lap over sustained heavy braking',
    whyNow: 'FR thermal load crossed expected trajectory after sustained T10/T14 load.',
    impactIfUnchanged: '+0.40s projected over next 2 aggressive laps',
    raceObjective: 'Protect net track position against undercut window & sustain planned 1-stop.',
    relatedFactors: [
      { factor: 'T10 cornering workload', contribution: 31 },
      { factor: 'T14 cornering workload', contribution: 24 },
      { factor: 'Thermal stress penalty', contribution: 27 },
      { factor: 'Driver aggressive steering', contribution: 12 },
      { factor: 'Tyre age (18 laps)', contribution: 6 }
    ],
    recommendation: 'MANAGE FRONT-RIGHT FOR 2 LAPS',
    proposedRadio: {
      type: RadioCallType.MANAGEMENT,
      message: 'Manage front-right. T10 and T14. Two laps.'
    }
  },
  {
    id: 'alert_cliff_medium',
    type: 'TYRE_CLIFF',
    category: 'WARNING',
    title: 'MEDIUM DEGRADATION ACCELERATING',
    shortMessage: '~4 competitive laps remaining before cliff vertex',
    confidence: 76,
    confidenceLevel: 'MEDIUM',
    urgency: 70,
    severity: 65,
    status: AlertStatus.ACTIVE,
    currentValue: '+0.125 s/lap',
    expectedValue: '+0.060 s/lap',
    trend: 'Accelerating (+0.012 s/lap²)',
    whyNow: 'Usable grip compound consumed to 15% remaining.',
    impactIfUnchanged: '+1.2s pace drop if stint extended past Lap 28.',
    raceObjective: 'Execute optimal pit stop for HARD compound switch.',
    relatedFactors: [
      { factor: 'Compound vertex proximity', contribution: 55 },
      { factor: 'Track temperature', contribution: 25 },
      { factor: 'Axle wear imbalance', contribution: 20 }
    ],
    recommendation: 'BOX LAP 28 → HARD',
    proposedRadio: {
      type: RadioCallType.STRATEGY,
      message: 'Box this lap. Switch to Hard compound. Push on out-lap.'
    }
  },
  {
    id: 'alert_track_warning',
    type: 'TYRE_DEGRADATION',
    category: 'WARNING',
    title: 'TRACK SURFACE DEGRADATION ACCELERATING',
    shortMessage: 'Abrasive micro-texture increasing tyre degradation',
    confidence: 85,
    confidenceLevel: 'HIGH',
    urgency: 45,
    severity: 55,
    status: AlertStatus.ACTIVE,
    currentValue: '+0.045 s/lap',
    expectedValue: '+0.010 s/lap',
    trend: 'Rising micro-abrasion',
    whyNow: 'Track thermal peak causing surface graining.',
    impactIfUnchanged: 'Increased surface blistering over stint.',
    raceObjective: 'Protect tyre shoulders through high-speed turns.',
    relatedFactors: [
      { factor: 'Surface abrasion rate', contribution: 60 },
      { factor: 'Track temperature', contribution: 40 }
    ],
    recommendation: 'AVOID CURB STRIKES AT T7',
    proposedRadio: null
  }
];

const mockIntelResult = {
  alerts: mockAlerts,
  topAlerts: mockAlerts,
  learningLog: [
    {
      alertId: 'alert_thermal_fr',
      type: 'THERMAL_RISK',
      metric: 'Carcass Temp (°C)',
      predicted: 108.0,
      actual: 107.5,
      error: 0.05,
      lap: 18,
      unit: '°C'
    }
  ],
  activeCount: 3,
  opportunityCount: 0
};

async function runAllTests() {
  await test('Race Intelligence Page Initialization', () => {
    initRaceIntelligencePage();
    const container = getOrCreateElem('race-alerts-list');
    assert.ok(container, 'race-alerts-list container must exist');
  });

  await test('Alert Cards Indicate Attached Radio Messages (From alert we know it has message)', () => {
    updateRaceIntelligenceUI(mockIntelResult, 18, 61);

    const container = getOrCreateElem('race-alerts-list');
    assert.ok(container.innerHTML.includes('FRONT-RIGHT THERMAL DEGRADATION'), 'Must contain top alert title');
    assert.ok(container.innerHTML.includes('MEDIUM DEGRADATION ACCELERATING'), 'Must contain warning alert title');

    // Must show radio banner on alerts with proposedRadio
    assert.ok(container.innerHTML.includes('📻 RADIO: "Manage front-right. T10 and T14. Two laps."'), 'Thermal alert must have radio ready indicator');
    assert.ok(container.innerHTML.includes('📻 RADIO: "Box this lap. Switch to Hard compound. Push on out-lap."'), 'Cliff alert must have radio ready indicator');

    // Informational alert without radio does not display the radio banner
    assert.ok(!container.innerHTML.includes('📻 RADIO: "Track is rubbering'), 'Informational alert without radio must not show radio banner');
  });

  await test('Detail Panel Starts as Blank Space and Opens Insight on Click', () => {
    const detailPanel = getOrCreateElem('intel-detail-panel');
    
    // Before clicking an alert, it must be completely blank space
    assert.strictEqual(detailPanel.style.display, 'none', 'Detail panel must be hidden (blank space) before an alert is clicked');
    assert.strictEqual(detailPanel.innerHTML, '', 'Detail panel content must be completely blank before an alert is clicked');

    // Click first card to open its insight
    const container = getOrCreateElem('race-alerts-list');
    const cards = container.querySelectorAll('.intel-alert-card');
    assert.strictEqual(cards.length, 3, 'Must have 3 cards rendered');
    cards[0].click();

    // Now the insight must be displayed in that place
    assert.strictEqual(detailPanel.style.display, 'block', 'Detail panel must display when an alert is clicked');
    assert.ok(detailPanel.innerHTML.includes('CURRENTLY VIEWING ROOT-CAUSE DIAGNOSIS'), 'Must have viewing header');
    assert.ok(detailPanel.innerHTML.includes('FRONT-RIGHT THERMAL DEGRADATION'), 'Must show selected alert title');
    assert.ok(detailPanel.innerHTML.includes('CURRENT STATE'), 'Must show CURRENT STATE metric header');
    assert.ok(detailPanel.innerHTML.includes('EXPECTED (BASELINE)'), 'Must show EXPECTED metric header');
    assert.ok(detailPanel.innerHTML.includes('TREND'), 'Must show TREND');
    assert.ok(detailPanel.innerHTML.includes('WHY NOW?'), 'Must show WHY NOW? trigger');
    assert.ok(detailPanel.innerHTML.includes('PRIMARY CONTRIBUTORS'), 'Must show PRIMARY CONTRIBUTORS');
    assert.ok(detailPanel.innerHTML.includes('T10 cornering workload'), 'Must show contributor breakdown factor');
    assert.ok(detailPanel.innerHTML.includes('31%'), 'Must show contributor breakdown percentage');
    assert.ok(detailPanel.innerHTML.includes('IMPACT IF UNCHANGED'), 'Must show IMPACT IF UNCHANGED');
    assert.ok(detailPanel.innerHTML.includes('RACE OBJECTIVE'), 'Must show RACE OBJECTIVE');
    assert.ok(detailPanel.innerHTML.includes('CONFIDENCE ENGINE RATING:'), 'Must show CONFIDENCE ENGINE RATING');
    assert.ok(detailPanel.innerHTML.includes('87% HIGH'), 'Must show 87% HIGH confidence');
    assert.ok(detailPanel.innerHTML.includes('AUTHORITATIVE STRATEGY PRESCRIPTION'), 'Must show Authoritative Prescription');
    assert.ok(detailPanel.innerHTML.includes('MANAGE FRONT-RIGHT FOR 2 LAPS'), 'Must show strategy recommendation');

    // Embedded Pit Wall Radio Dispatch module directly inside the detail panel
    assert.ok(detailPanel.innerHTML.includes('PIT WALL RADIO DISPATCH'), 'Must have embedded pit wall radio dispatch inside alert');
    assert.ok(detailPanel.innerHTML.includes('"Manage front-right. T10 and T14. Two laps."'), 'Must show driver message');
    assert.ok(detailPanel.innerHTML.includes('CAR #11 · CH 1'), 'Must show F1 car channel');
  });

  await test('Clicking Selected Alert Again or [✕ CLOSE] Collapses to Blank Space', () => {
    const container = getOrCreateElem('race-alerts-list');
    const cards = container.querySelectorAll('.intel-alert-card');
    const detailPanel = getOrCreateElem('intel-detail-panel');

    // First card is currently open. Click it again to TOGGLE CLOSE!
    cards[0].click();

    // Detail panel should now return to completely blank space
    assert.strictEqual(detailPanel.style.display, 'none', 'Detail panel must return to hidden blank space when toggled closed');
    assert.strictEqual(detailPanel.innerHTML, '', 'Detail panel must be empty blank space when toggled closed');

    // Click second card to OPEN second alert
    cards[1].click();
    assert.strictEqual(detailPanel.style.display, 'block', 'Detail panel must open when second alert is clicked');
    assert.ok(detailPanel.innerHTML.includes('MEDIUM DEGRADATION ACCELERATING'), 'Must open second alert diagnostics');

    // Click explicit [✕ CLOSE] button inside header
    const btnClose = getOrCreateElem('btn-close-detail');
    assert.ok(btnClose, 'Close button must exist');
    btnClose.click();

    // Must collapse back to blank space
    assert.strictEqual(detailPanel.style.display, 'none', 'Detail panel must return to blank space on close button click');
    assert.strictEqual(detailPanel.innerHTML, '', 'Detail panel must be empty on close button click');
  });

  await test('Embedded Pit Wall Radio Allows Message Editing & Transmission Inside Alert', () => {
    const container = getOrCreateElem('race-alerts-list');
    const cards = container.querySelectorAll('.intel-alert-card');
    cards[0].click(); // Open thermal alert with embedded radio

    const detailPanel = getOrCreateElem('intel-detail-panel');
    const editBtn = detailPanel.querySelector('.btn-edit-embedded-radio');
    const transmitBtn = detailPanel.querySelector('.btn-transmit-embedded-radio');

    assert.ok(editBtn, 'Must have edit button inside alert radio box');
    assert.ok(transmitBtn, 'Must have transmit button inside alert radio box');

    // Test editing
    editBtn.click();
    assert.strictEqual(editBtn.textContent, '💾 SAVE', 'Must change to SAVE');
    editBtn.click();
    assert.strictEqual(editBtn.textContent, '✏️ EDIT', 'Must revert to EDIT');

    // Test transmitting
    transmitBtn.click();
    const statusEl = detailPanel.querySelector('#embedded-radio-status-alert_thermal_fr');
    assert.strictEqual(statusEl.style.display, 'inline-block', 'Status must show transmission banner');
    assert.ok(statusEl.textContent.includes('TRANSMITTED TO CAR #11'), 'Must confirm transmission to car 11');

    // Toggle close back to blank space
    cards[0].click();
  });

  await test('Initial Race Alerts Click Selection & Insight Rendering Across Multiple Alerts', async () => {
    const { getInitialRaceIntelligence } = await import('./raceIntelligenceFeed.js');
    const initIntel = getInitialRaceIntelligence(null, 'singapore');
    updateRaceIntelligenceUI(initIntel, 1, 61);

    const container = getOrCreateElem('race-alerts-list');
    const detailPanel = getOrCreateElem('intel-detail-panel');
    const headerLabel = getOrCreateElem('intel-detail-header-label');

    // Starts as blank space
    assert.strictEqual(detailPanel.style.display, 'none', 'Starts as blank space');
    assert.strictEqual(headerLabel.style.display, 'none', 'Header label hidden initially');

    const cards = container.querySelectorAll('.intel-alert-card');
    assert.ok(cards.length >= 3, 'Must render initial alerts');

    // Click card 0 (Optimal 1-Stop Stint Strategy)
    cards[0].click();
    assert.strictEqual(detailPanel.style.display, 'block', 'Detail panel opens on clicking card 0');
    assert.strictEqual(headerLabel.style.display, 'block', 'Header label shows on click');
    assert.ok(detailPanel.innerHTML.includes('OPTIMAL 1-STOP STINT STRATEGY'), 'Must display card 0 title in insight');
    assert.ok(detailPanel.innerHTML.includes('PIT WALL RADIO DISPATCH'), 'Card 0 must display embedded radio dispatch');

    // Click card 1 (Thermal Operating Window)
    cards[1].click();
    assert.strictEqual(detailPanel.style.display, 'block', 'Detail panel remains open when clicking card 1');
    assert.ok(detailPanel.innerHTML.includes('THERMAL OPERATING WINDOW'), 'Must display card 1 title in insight');

    // Click card 1 again -> TOGGLE CLOSE -> blank space
    cards[1].click();
    assert.strictEqual(detailPanel.style.display, 'none', 'Toggling card 1 must close back to blank space');
    assert.strictEqual(headerLabel.style.display, 'none', 'Header label must hide on close');

    // Click card 2 (Undercut Window Defence)
    cards[2].click();
    assert.strictEqual(detailPanel.style.display, 'block', 'Detail panel opens on clicking card 2');
    assert.ok(detailPanel.innerHTML.includes('UNDERCUT WINDOW DEFENCE'), 'Must display card 2 title in insight');
  });

  await test('Header Alert Notification Badge Displays Latest Error and Direct Opens That Specific Alert', () => {
    // Re-feed with mock alerts containing 1 CRITICAL
    updateRaceIntelligenceUI(mockIntelResult, 18, 61);

    const headerBadge = getOrCreateElem('rc-header-intel-alert');
    const headerText = getOrCreateElem('rc-header-alert-text');
    const headerIcon = getOrCreateElem('rc-header-alert-icon');
    const detailPanel = getOrCreateElem('intel-detail-panel');

    assert.strictEqual(headerBadge.style.display, 'flex', 'Badge must be visible when error exists');
    assert.ok(headerText.textContent.includes('1 CRITICAL'), 'Badge text must show 1 CRITICAL');
    assert.ok(headerText.textContent.includes('(+MORE)'), 'Badge text must show (+MORE) when multiple alerts exist');
    assert.strictEqual(headerIcon.textContent, '🔴', 'Icon must be red circle');
    assert.strictEqual(headerBadge.dataset.alertId, 'alert_thermal_fr', 'Must store target alertId');

    // Click the header notification badge
    headerBadge.click();

    // Must open that exact alert's detail insight
    assert.strictEqual(detailPanel.style.display, 'block', 'Must open detail panel when clicking header notification');
    assert.ok(detailPanel.innerHTML.includes('FRONT-RIGHT THERMAL DEGRADATION'), 'Must show the critical alert detail');

    // Feed nominal data (0 errors) -> Header alert must be hidden completely ('display: none')
    updateRaceIntelligenceUI({ topAlerts: [] }, 19, 61);
    assert.strictEqual(headerBadge.style.display, 'none', 'Header alert badge must be hidden when there are no errors');
    assert.strictEqual(headerBadge.dataset.alertId, '', 'Alert ID must be cleared');

    // Feed only OPPORTUNITY or INFO alert -> Must still be hidden in header badge and not show OPP in activeBadge ticker
    const oppOnlyResult = {
      topAlerts: [
        {
          id: 'alert_opp_1',
          category: 'OPPORTUNITY',
          title: 'UNDERCUT OPPORTUNITY',
          shortMessage: 'Window open',
          confidence: 80,
          confidenceLevel: 'HIGH',
          status: AlertStatus.ACTIVE
        }
      ]
    };
    updateRaceIntelligenceUI(oppOnlyResult, 20, 61);
    assert.strictEqual(headerBadge.style.display, 'none', 'Header alert badge must NOT show for OPPORTUNITY/INFO values');
    const activeBadge = getOrCreateElem('rc-intel-active-badge');
    assert.strictEqual(activeBadge.textContent, '✓ ALL CLEAR', 'Active badge ticker must report ALL CLEAR when only OPP/INFO exist');
  });

  console.log(`\n🏁 ALL ${passedTests} RACE ALERTS UI & PIT WALL RADIO TESTS PASSED PERFECTLY!\n`);
}

runAllTests().catch(err => {
  console.error(err);
  process.exit(1);
});

