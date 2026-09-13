// test_turn_markers.js - Unit and DOM test for track turn markers and degradation color circles
import assert from 'assert';
import { getTurnDisplayName } from './track.js';
import { CIRCUIT_SEGMENTS, computeTrackDegradationMap } from './trackDegradationMap.js';

console.log('🏁 Starting Track Turn Markers & Degradation Color Circles Test Suite...\n');

// 1. Test Turn Name Extraction across all tracks
console.log('1. Testing getTurnDisplayName extraction:');

// Singapore
const s1 = { name: 'Turns 1-3 (Sheares)' };
const s2 = { name: 'Turns 4-5 (Republic)' };
const sStraight = { name: 'Raffles Ave Straight', type: 'HIGH_SPEED' };
const s7 = { name: 'Turn 7 (Memorial Corner)' };
const sPit = { name: 'Main Pit Straight', type: 'HIGH_SPEED' };

assert.strictEqual(getTurnDisplayName(s1), 'Turn 1-3');
assert.strictEqual(getTurnDisplayName(s2), 'Turn 4-5');
assert.strictEqual(getTurnDisplayName(sStraight), null, 'Straights must return null');
assert.strictEqual(getTurnDisplayName(s7), 'Turn 7');
assert.strictEqual(getTurnDisplayName(sPit), null, 'Pit straight must return null');
console.log('  ✓ Singapore turn names extracted correctly');

// Monza
const m1 = { name: 'Variante del Rettifilo (T1-2)' };
const m2 = { name: 'Curva Grande (T3)' };
const mAscari = { name: 'Variante Ascari (T8-10)' };
const mParabolica = { name: 'Curva Parabolica (T11)' };
assert.strictEqual(getTurnDisplayName(m1), 'Turn 1-2');
assert.strictEqual(getTurnDisplayName(m2), 'Turn 3');
assert.strictEqual(getTurnDisplayName(mAscari), 'Turn 8-10');
assert.strictEqual(getTurnDisplayName(mParabolica), 'Turn 11');
console.log('  ✓ Monza turn names extracted correctly');

// Monaco
const mc1 = { name: 'Sainte Dévote (T1)' };
const mcHairpin = { name: 'Grand Hotel Hairpin (T6)' };
const mcPool = { name: 'Swimming Pool & Rascasse (T13-19)' };
assert.strictEqual(getTurnDisplayName(mc1), 'Turn 1');
assert.strictEqual(getTurnDisplayName(mcHairpin), 'Turn 6');
assert.strictEqual(getTurnDisplayName(mcPool), 'Turn 13-19');
console.log('  ✓ Monaco turn names extracted correctly');

// 2. Test Degradation Map Intensity & Colors
console.log('\n2. Testing computeTrackDegradationMap:');
const map = computeTrackDegradationMap('singapore');
assert.ok(Array.isArray(map) && map.length > 0, 'Must return array of segments');

map.forEach(seg => {
  const turnName = getTurnDisplayName(seg);
  if (turnName) {
    assert.ok(seg.color, `Turn ${turnName} must have a degradation color`);
    assert.ok(seg.intensity >= 0 && seg.intensity <= 100, `Turn ${turnName} intensity must be in [0, 100]`);
    console.log(`  Turn: ${turnName.padEnd(12)} Intensity: ${String(seg.intensity).padStart(2)}/100  Color: ${seg.color} (${seg.primaryTag})`);
  }
});

console.log('\n3. Testing SVG DOM rendering:');

class MockSVGElement {
  constructor(tagName = 'g') {
    this.tagName = tagName;
    this.attributes = {};
    this.style = {};
    this.children = [];
    this.textContent = '';
  }
  get id() { return this.attributes.id || ''; }
  set id(val) { this.attributes.id = val; }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return this.attributes[k]; }
  appendChild(child) {
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  querySelector(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.find(c => c.getAttribute('class') === cls) || null;
    }
    return null;
  }
  querySelectorAll(sel) {
    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      return this.children.filter(c => c.getAttribute('class') === cls);
    }
    return [];
  }
  getTotalLength() { return 1000; }
  getPointAtLength(len) {
    const angle = (len / 1000) * 2 * Math.PI;
    return { x: 400 + 200 * Math.cos(angle), y: 300 + 150 * Math.sin(angle) };
  }
}

global.document = {
  createElementNS: (ns, tag) => new MockSVGElement(tag),
  createElement: (tag) => new MockSVGElement(tag)
};

import { initTrack, renderTrackDegradation, highlightActiveTurn } from './track.js';

const mockContainer = new MockSVGElement('div');
initTrack(mockContainer);

// Get the turn markers group
const svg = mockContainer.children[0];
const markersGroup = svg.children.find(c => c.attributes.id === 'track-turn-markers');
assert.ok(markersGroup, 'Must have track-turn-markers group');

renderTrackDegradation(map);

const pins = markersGroup.children.filter(c => c.getAttribute('class') === 'turn-marker-pin');
assert.ok(pins.length >= 8, `Must have at least 8 turn pins for Singapore, found ${pins.length}`);

// Check each pin contains turn name and small colored circle
pins.forEach(pin => {
  const circle = pin.children.find(c => c.getAttribute('class') === 'turn-color-circle');
  assert.ok(circle, 'Turn pin must have .turn-color-circle');
  assert.ok(circle.getAttribute('fill'), 'Circle must have fill color');
  assert.strictEqual(circle.getAttribute('r'), '4.5', 'Circle must have radius 4.5');

  const text = pin.children.find(c => c.getAttribute('class') === 'turn-name-text');
  assert.ok(text, 'Turn pin must have .turn-name-text');
  assert.ok(text.textContent.startsWith('Turn '), `Text must start with 'Turn ', got ${text.textContent}`);
  assert.strictEqual(text.getAttribute('fill'), '#000000', 'Text must be bold black');
  assert.strictEqual(text.getAttribute('stroke'), '#ffffff', 'Text must have white stroke halo');
});
console.log(`  ✓ Successfully rendered ${pins.length} turn pins with turn names and colored circles`);

// Test active turn highlighting
highlightActiveTurn('T1_3');
const activePin = pins.find(p => p.getAttribute('data-seg-id') === 'T1_3');
assert.ok(activePin.getAttribute('transform').includes('scale(1.35)'), 'Active turn must scale up to 1.35');
const activeCircle = activePin.children.find(c => c.getAttribute('class') === 'turn-color-circle');
assert.strictEqual(activeCircle.getAttribute('r'), '6', 'Active circle radius must increase to 6');
console.log('  ✓ highlightActiveTurn successfully highlighted active turn');

console.log('\n🏁 ALL TURN MARKER & DEGRADATION CIRCLE TESTS PASSED!\n');
