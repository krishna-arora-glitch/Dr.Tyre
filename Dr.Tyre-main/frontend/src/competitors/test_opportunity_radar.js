// test_opportunity_radar.js - Unit and headless test for Opportunity Radar feature
import assert from 'assert';

console.log('🏁 Starting Opportunity Radar & Competitor Comparison Test Suite...\n');

class MockDOMElement {
  constructor(id = '', tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.innerHTML = '';
    this.children = [];
    this.style = {};
  }
  addEventListener() {}
}

const mockRadar = new MockDOMElement('competitors-opportunity-radar');
const mockTbody = new MockDOMElement('competitors-table-body');

global.window = {
  addEventListener: () => {},
  modelData: {}
};

global.document = {
  getElementById: (id) => {
    if (id === 'competitors-opportunity-radar') return mockRadar;
    if (id === 'competitors-table-body') return mockTbody;
    return new MockDOMElement(id);
  },
  addEventListener: () => {}
};

import { initCompetitorsPage, updateCompetitorsTable } from './competitorsPage.js';

const mockSimState = {
  lap: 38,
  totalLaps: 61,
  cars: [
    { id: '1', number: 1, position: 1, progress: 0.85, lapsCompleted: 38, compound: 'HARD', tyreAge: 18, isUser: false },
    { id: '4', number: 4, position: 5, progress: 0.52, lapsCompleted: 38, compound: 'MEDIUM', tyreAge: 24, isUser: false },
    { id: '16', number: 16, position: 6, progress: 0.50, lapsCompleted: 38, compound: 'HARD', tyreAge: 22, isUser: false },
    { id: '11', number: 11, position: 7, progress: 0.48, lapsCompleted: 38, compound: 'MEDIUM', tyreAge: 16, isUser: true },
    { id: '55', number: 55, position: 8, progress: 0.46, lapsCompleted: 38, compound: 'SOFT', tyreAge: 10, isUser: false }
  ]
};

initCompetitorsPage({ compounds: { MEDIUM: { cliff_lap: 30 } } });
updateCompetitorsTable(mockSimState);

// Trigger render by dispatching simulation state
console.log('1. Testing Opportunity Radar HUD generation:');
// Directly test updateCompetitorsTable via simState
assert.ok(mockRadar.innerHTML.includes('RACE OPPORTUNITIES'), 'Must render RACE OPPORTUNITIES header');
assert.ok(mockRadar.innerHTML.includes('What can we exploit right now?'), 'Must render strategist subtitle');
assert.ok(mockRadar.innerHTML.includes('OVERTAKE'), 'Must render OVERTAKE card');
assert.ok(mockRadar.innerHTML.includes('Probability:'), 'Must display Probability metric');
assert.ok(mockRadar.innerHTML.includes('UNDERCUT'), 'Must render UNDERCUT card');
assert.ok(mockRadar.innerHTML.includes('Window:'), 'Must display Window metric');
assert.ok(mockRadar.innerHTML.includes('EXTEND STINT'), 'Must render EXTEND STINT card');
assert.ok(mockRadar.innerHTML.includes('Potential:'), 'Must display Potential metric');
assert.ok(mockRadar.innerHTML.includes('DEFEND'), 'Must render DEFEND card');
assert.ok(mockRadar.innerHTML.includes('Threat arriving in'), 'Must display Threat metric');
console.log('  ✓ Opportunity Radar HUD rendered all 4 core exploitation cards with live metrics');

console.log('\n2. Testing Competitor Table Opportunity Radar column:');
console.log('RENDERED TABLE HTML:\n', mockTbody.innerHTML);
assert.ok(mockTbody.innerHTML.includes('OVERTAKE P6'), 'Rival ahead P6 should have OVERTAKE badge');
assert.ok(mockTbody.innerHTML.includes('DEFEND P8'), 'Rival behind P8 should have DEFEND badge');
assert.ok(mockTbody.innerHTML.includes('EXTEND STINT'), 'User car should display EXTEND STINT badge');
console.log('  ✓ Competitor table rendered dynamic Opportunity Radar badges in table rows');

console.log('\n🏁 ALL OPPORTUNITY RADAR TESTS PASSED!\n');
