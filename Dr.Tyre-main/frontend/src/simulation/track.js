// track.js - SVG Based 2D Track Renderer (Fashionable Edition)
import { getLapTelemetry } from './telemetry-ui.js';
import { computeTrackDegradationMap } from './trackDegradationMap.js';

let svgTrackPath = null;
let svgPitPath = null;
let trackLength = 0;
let pitLength = 0;
let carElements = new Map();
let svgContainer = null;
let currentPitLane = null;
let currentTrackPathD = null;
let degradationGroup = null;
let turnMarkersGroup = null;
let activeHighlightedTurnId = null;
let cachedTrackMap = null;
const boxTargets = new Map();

const CAR_COLORS = {
  'Red Bull': '#0600ef',
  'Mercedes': '#00d2be',
  'Ferrari': '#dc0000',
  'McLaren': '#ff8700',
  'Aston Martin': '#006f62',
  'Alpine': '#0090ff',
  'Williams': '#005aff',
  'RB': '#6692ff',
  'Sauber': '#00e701',
  'Haas': '#ffffff'
};

export function getPitLaneConfig() {
  return currentPitLane;
}

export function getPitBoxTarget(teamName) {
  return boxTargets.has(teamName) ? boxTargets.get(teamName) : 0.5;
}

export function initTrack(containerEl, trackPathD = null, pitLaneConfig = null) {
  containerEl.innerHTML = '';
  carElements.clear();
  boxTargets.clear();
  degradationGroup = null;
  turnMarkersGroup = null;
  activeHighlightedTurnId = null;
  
  svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgContainer.setAttribute('viewBox', '0 0 800 600');
  svgContainer.style.width = '100%';
  svgContainer.style.height = '100%';
  svgContainer.style.overflow = 'visible';
  
  // Define Filters and Gradients
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  svgContainer.appendChild(defs);
  
  const defaultPath = 'M 400,80 C 550,80 650,120 680,200 C 710,280 720,350 700,420 C 680,490 620,530 550,540 C 480,550 420,555 350,540 C 280,525 200,500 150,440 C 100,380 80,300 100,220 C 120,140 200,80 300,75 C 340,73 370,77 400,80 Z';
  const tPath = trackPathD || defaultPath;
  currentTrackPathD = tPath;
  
  // Track Outline (Sticker effect)
  const trackBase = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trackBase.setAttribute('d', tPath);
  trackBase.setAttribute('fill', 'none');
  trackBase.setAttribute('stroke', '#000000'); // Black outline
  trackBase.setAttribute('stroke-width', '34');
  svgContainer.appendChild(trackBase);
  
  // Track Surface (White Clean Track)
  svgTrackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svgTrackPath.setAttribute('d', tPath);
  svgTrackPath.setAttribute('fill', 'none');
  svgTrackPath.setAttribute('stroke', '#ffffff'); // White track
  svgTrackPath.setAttribute('stroke-width', '32');
  svgContainer.appendChild(svgTrackPath);

  // Track Inner Racing Line (Dashed)
  const racingLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  racingLine.setAttribute('d', tPath);
  racingLine.setAttribute('fill', 'none');
  racingLine.setAttribute('stroke', '#cccccc');
  racingLine.setAttribute('stroke-width', '2');
  racingLine.setAttribute('stroke-dasharray', '12, 12');
  svgContainer.appendChild(racingLine);
  
  // Start/Finish Line - position dynamically from path start
  currentPitLane = pitLaneConfig;
  svgPitPath = null;
  
  if (currentPitLane && currentPitLane.centerline) {
    // Pit lane outline
    const pitGlow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pitGlow.setAttribute('d', currentPitLane.centerline);
    pitGlow.setAttribute('fill', 'none');
    pitGlow.setAttribute('stroke', '#000000');
    pitGlow.setAttribute('stroke-width', '16');
    svgContainer.appendChild(pitGlow);

    // Pit lane surface
    svgPitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgPitPath.setAttribute('d', currentPitLane.centerline);
    svgPitPath.setAttribute('fill', 'none');
    svgPitPath.setAttribute('stroke', '#ffffff');
    svgPitPath.setAttribute('stroke-width', '14');
    svgContainer.appendChild(svgPitPath);

    // Pit lane dashed center
    const pitCenter = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pitCenter.setAttribute('d', currentPitLane.centerline);
    pitCenter.setAttribute('fill', 'none');
    pitCenter.setAttribute('stroke', '#cccccc');
    pitCenter.setAttribute('stroke-width', '1');
    pitCenter.setAttribute('stroke-dasharray', '4, 4');
    svgContainer.appendChild(pitCenter);
    
    if (currentPitLane.boxes) {
      currentPitLane.boxes.forEach((box) => {
        boxTargets.set(box.team, box.progress);
      });
    }
  }

  // Turn Markers and Badges Layer (above track & pit lane, below cars)
  turnMarkersGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  turnMarkersGroup.id = 'track-turn-markers';
  svgContainer.appendChild(turnMarkersGroup);
  
  containerEl.appendChild(svgContainer);
  
  // Get lengths
  try {
    trackLength = svgTrackPath.getTotalLength();
  } catch (e) {
    trackLength = 0;
  }
  if (svgPitPath) {
    try {
      pitLength = svgPitPath.getTotalLength();
    } catch (e) {
      pitLength = 0;
    }
  }
  
  // Place the Start/Finish line dynamically
  if (trackLength > 0 && typeof svgTrackPath.getPointAtLength === 'function') {
    const sfPt = svgTrackPath.getPointAtLength(0);
    const sfPt2 = svgTrackPath.getPointAtLength(2);
    if (sfPt && sfPt2) {
      const dx = sfPt2.x - sfPt.x;
      const dy = sfPt2.y - sfPt.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const nx = dist > 0 ? -dy / dist : 0;
      const ny = dist > 0 ? dx / dist : 1;
      const halfWidth = 14;
      
      const sfLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      sfLine1.setAttribute('x1', sfPt.x + nx * halfWidth);
      sfLine1.setAttribute('y1', sfPt.y + ny * halfWidth);
      sfLine1.setAttribute('x2', sfPt.x - nx * halfWidth);
      sfLine1.setAttribute('y2', sfPt.y - ny * halfWidth);
      sfLine1.setAttribute('stroke', '#fff');
      sfLine1.setAttribute('stroke-width', '4');
      sfLine1.setAttribute('stroke-dasharray', '4, 4');
      svgContainer.appendChild(sfLine1);
      
      const offset = 4;
      const sfLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      sfLine2.setAttribute('x1', sfPt.x + nx * halfWidth + (dx / dist) * offset);
      sfLine2.setAttribute('y1', sfPt.y + ny * halfWidth + (dy / dist) * offset);
      sfLine2.setAttribute('x2', sfPt.x - nx * halfWidth + (dx / dist) * offset);
      sfLine2.setAttribute('y2', sfPt.y - ny * halfWidth + (dy / dist) * offset);
      sfLine2.setAttribute('stroke', '#fff');
      sfLine2.setAttribute('stroke-width', '4');
      sfLine2.setAttribute('stroke-dasharray', '4, 4');
      sfLine2.setAttribute('stroke-dashoffset', '4');
      svgContainer.appendChild(sfLine2);
    }
  }

  const trackMapToRender = cachedTrackMap || computeTrackDegradationMap('singapore');
  renderTrackDegradation(trackMapToRender);
  
  return { trackPath: tPath, trackLength: 1.0 };
}

/**
 * Extracts a clean, readable turn name (e.g. 'Turn 1-3', 'Turn 4-5', 'Turn 7', 'Turn 10', 'Turn 14')
 * for rendering directly on the circuit. Returns null for straights.
 */
export function getTurnDisplayName(seg) {
  if (!seg || !seg.name) return null;
  if (seg.name.includes('Straight')) return null;
  if (seg.type === 'HIGH_SPEED' && !seg.name.includes('(T') && !seg.name.includes('Turn')) return null;

  const matchTurn = seg.name.match(/Turns?\s*(\d+(?:-\d+)?)/i);
  if (matchTurn) {
    return `Turn ${matchTurn[1]}`;
  }
  const matchT = seg.name.match(/\(T(\d+(?:-\d+)?)\)/i);
  if (matchT) {
    return `Turn ${matchT[1]}`;
  }
  if (seg.id && seg.id.startsWith('T')) {
    return `Turn ${seg.id.substring(1).replace('_', '-')}`;
  }
  return null;
}

/**
 * Renders the turn name and a small colored circle beside it according to tyre degradation severity.
 * 
 * @param {Array<Object>} trackMap - Evaluated circuit segments with degradation intensity and colors
 */
export function renderTrackDegradation(trackMap) {
  if (!trackMap || !Array.isArray(trackMap) || trackMap.length === 0) return;
  cachedTrackMap = trackMap;

  if (!svgContainer || !svgTrackPath || !turnMarkersGroup) return;

  if (!trackLength || trackLength <= 0) {
    try {
      trackLength = svgTrackPath.getTotalLength();
    } catch (e) {}
  }
  if (!trackLength || trackLength <= 0) return;
  if (typeof svgTrackPath.getPointAtLength !== 'function') return;

  turnMarkersGroup.innerHTML = '';

  // Approximate track centroid by sampling points along path
  let sumX = 0, sumY = 0, sampleCount = 32;
  for (let i = 0; i < sampleCount; i++) {
    const pt = svgTrackPath.getPointAtLength((i / sampleCount) * trackLength);
    if (pt) {
      sumX += pt.x;
      sumY += pt.y;
    }
  }
  const cx = sampleCount > 0 ? sumX / sampleCount : 400;
  const cy = sampleCount > 0 ? sumY / sampleCount : 300;

  trackMap.forEach(seg => {
    // Draw Turn Name & Degradation Circle if it represents a turn
    const turnLabel = getTurnDisplayName(seg);
    if (turnLabel) {
      const startP = ((seg.startPos % 1) + 1) % 1;
      const endP = ((seg.endPos % 1) + 1) % 1;
      let midP = startP + (endP >= startP ? (endP - startP) / 2 : (1.0 - startP + endP) / 2);
      midP = ((midP % 1) + 1) % 1;
      const midDist = midP * trackLength;

      const pt = svgTrackPath.getPointAtLength(midDist);
      const pt2 = svgTrackPath.getPointAtLength((midDist + 4) % trackLength);
      if (pt && pt2) {
        const dx = pt2.x - pt.x;
        const dy = pt2.y - pt.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0) {
          let nx = -dy / dist;
          let ny = dx / dist;
          // Ensure normal points outward away from track center
          if (nx * (pt.x - cx) + ny * (pt.y - cy) < 0) {
            nx = -nx;
            ny = -ny;
          }

          const offset = 32;
          const markerX = Math.round(pt.x + nx * offset);
          const markerY = Math.round(pt.y + ny * offset);

          const pinGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          pinGroup.setAttribute('class', 'turn-marker-pin');
          pinGroup.setAttribute('data-seg-id', seg.id);
          pinGroup.setAttribute('data-orig-x', markerX);
          pinGroup.setAttribute('data-orig-y', markerY);
          pinGroup.setAttribute('transform', `translate(${markerX}, ${markerY})`);
          pinGroup.style.cursor = 'default';
          pinGroup.style.transition = 'transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1)';

          // Layout calculation: Circle on left, turn name on right, centered at (markerX, markerY)
          const charCount = turnLabel.length;
          const approxTextW = charCount * 5.8;
          const circleR = 4.5;
          const gap = 5.5;
          const totalW = (circleR * 2) + gap + approxTextW;
          const startX = -totalW / 2;
          const circleCx = Math.round((startX + circleR) * 10) / 10;
          const textX = Math.round((startX + (circleR * 2) + gap) * 10) / 10;

          // Small color circle according to tyre degradation severity
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('class', 'turn-color-circle');
          circle.setAttribute('cx', circleCx);
          circle.setAttribute('cy', '0');
          circle.setAttribute('r', circleR);
          circle.setAttribute('fill', seg.color);
          circle.setAttribute('stroke', '#000000');
          circle.setAttribute('stroke-width', '1.2');
          pinGroup.appendChild(circle);

          // Turn Name Text
          const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          text.setAttribute('class', 'turn-name-text');
          text.setAttribute('x', textX);
          text.setAttribute('y', '3.5');
          text.setAttribute('text-anchor', 'start');
          text.setAttribute('font-family', 'var(--font-mono, monospace)');
          text.setAttribute('font-size', '9.5px');
          text.setAttribute('font-weight', '900');
          text.setAttribute('fill', '#000000');
          text.setAttribute('stroke', '#ffffff');
          text.setAttribute('stroke-width', '2.8');
          text.setAttribute('stroke-linejoin', 'round');
          text.setAttribute('paint-order', 'stroke fill');
          text.setAttribute('letter-spacing', '-0.2px');
          text.textContent = turnLabel;
          pinGroup.appendChild(text);

          // Tooltip
          const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = `${seg.name}\nTyre Wear: ${seg.intensity}/100 (${seg.primaryTag})\nCornering: ${seg.contributors?.cornering || 0}%, Thermal: ${seg.contributors?.thermal || 0}%, Braking: ${seg.contributors?.braking || 0}%, Traction: ${seg.contributors?.traction || 0}%`;
          pinGroup.appendChild(title);

          turnMarkersGroup.appendChild(pinGroup);
        }
      }
    }
  });
}

/**
 * Highlights the active turn that the user car is currently driving through.
 * 
 * @param {string} activeSegId - ID of the active track segment
 */
export function highlightActiveTurn(activeSegId) {
  if (activeSegId === activeHighlightedTurnId) return;
  activeHighlightedTurnId = activeSegId;

  if (turnMarkersGroup && turnMarkersGroup.children) {
    for (let i = 0; i < turnMarkersGroup.children.length; i++) {
      const pin = turnMarkersGroup.children[i];
      if (!pin.getAttribute) continue;
      const id = pin.getAttribute('data-seg-id');
      const origX = pin.getAttribute('data-orig-x') || 0;
      const origY = pin.getAttribute('data-orig-y') || 0;
      const circle = pin.querySelector ? pin.querySelector('.turn-color-circle') : null;
      const text = pin.querySelector ? pin.querySelector('.turn-name-text') : null;
      if (id === activeSegId) {
        pin.setAttribute('transform', `translate(${origX}, ${origY}) scale(1.35)`);
        if (circle && circle.setAttribute) {
          circle.setAttribute('r', '6');
          circle.setAttribute('stroke-width', '1.8');
        }
        if (text && text.setAttribute) {
          text.setAttribute('stroke-width', '3.5');
        }
      } else {
        pin.setAttribute('transform', `translate(${origX}, ${origY}) scale(1.0)`);
        if (circle && circle.setAttribute) {
          circle.setAttribute('r', '4.5');
          circle.setAttribute('stroke-width', '1.2');
        }
        if (text && text.setAttribute) {
          text.setAttribute('stroke-width', '2.8');
        }
      }
    }
  }
}

export function syncCarsToSVG(cars, svgEl) {
  const carIds = new Set(cars.map(c => c.id));
  
  // Remove dead cars
  for (const [id, group] of carElements.entries()) {
    if (!carIds.has(id)) {
      if (group.parentNode) group.parentNode.removeChild(group);
      carElements.delete(id);
    }
  }
  
  // Add new cars
  cars.forEach(car => {
    if (!carElements.has(car.id)) {
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.id = 'car-' + car.id;
      group.classList.add('car-group');
      if (car.isUser) group.classList.add('user-car');
      
      const color = car.color || CAR_COLORS[car.team] || '#ffffff';
      
      if (car.isUser) {
        // User car halo (flat sticker style)
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('r', '16');
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', '#000000');
        halo.setAttribute('stroke-width', '1');
        halo.setAttribute('stroke-dasharray', '4, 4');
        group.appendChild(halo);
      }

      let shape;
      if (car.isUser) {
        // Create an arrow/pointer for the user car
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        shape.setAttribute('points', '-6,-10 14,0 -6,10');
        shape.setAttribute('fill', color);
        shape.setAttribute('stroke', '#000000'); // 1px black outline
        shape.setAttribute('stroke-width', '1');
      } else {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        shape.setAttribute('r', '8');
        shape.setAttribute('fill', color);
        shape.setAttribute('stroke', '#000000'); // 1px black outline
        shape.setAttribute('stroke-width', '1');
      }
      group.appendChild(shape);
      
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('y', car.isUser ? '4' : '3');
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('font-size', car.isUser ? '11px' : '9px');
      text.setAttribute('font-weight', '900');
      text.setAttribute('font-family', 'var(--font-mono, monospace)');
      text.setAttribute('fill', car.isUser ? '#000' : '#fff');
      text.textContent = car.isUser ? 'P' + car.position : car.number;
      text.classList.add('car-label');
      group.appendChild(text);
      
      svgContainer.appendChild(group);
      carElements.set(car.id, group);
    } else {
      // Update label
      const group = carElements.get(car.id);
      if (car.isUser) {
        const text = group.querySelector('.car-label');
        if (text) text.textContent = 'P' + car.position;
      }
    }
  });
}

export function renderCars(cars) {
  if (!svgTrackPath) return;
  
  // Fallback in case getTotalLength returned 0 during initialization
  if (!trackLength || trackLength <= 0) {
    try {
      trackLength = svgTrackPath.getTotalLength();
    } catch (e) {}
  }
  if (!trackLength || trackLength <= 0) return;

  // Auto-render turn markers on first frame when trackLength is ready
  if (turnMarkersGroup && turnMarkersGroup.children.length === 0) {
    const trackMapToRender = cachedTrackMap || computeTrackDegradationMap('singapore');
    renderTrackDegradation(trackMapToRender);
  }

  if (svgPitPath && (!pitLength || pitLength <= 0)) {
    try {
      pitLength = svgPitPath.getTotalLength();
    } catch (e) {}
  }
  
  cars.forEach(car => {
    const group = carElements.get(car.id);
    if (!group) return;
    
    let path = svgTrackPath;
    let t = ((car.progress % 1) + 1) % 1;
    
    let length = trackLength;
    
    if (car.pitState && svgPitPath && pitLength > 0) {
      path = svgPitPath;
      t = Math.min(Math.max(car.pitProgress || 0, 0), 1);
      length = pitLength;
    }
    
    t = Math.max(0, Math.min(1, isNaN(t) ? 0 : t));
    
    const pt = path.getPointAtLength(t * length);
    if (!pt || isNaN(pt.x) || isNaN(pt.y)) return;
    
    // Calculate rotation angle and normal vector
    let angle = 0;
    let nx = 0;
    let ny = 0;
    
    // Use modulo for path wrapping to prevent snap-to-0 at start/finish
    // Use 10px lookahead for a stable tangent to prevent waving/jerking
    const pt2Length = length > 10 ? ((t * length + 10) % length) : 0;
    const pt2 = path.getPointAtLength(pt2Length);
    const dx = pt2.x - pt.x;
    const dy = pt2.y - pt.y;
    
    if (dx !== 0 || dy !== 0) {
      angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const dist = Math.sqrt(dx*dx + dy*dy);
      nx = -dy / dist;
      ny = dx / dist;
    }
    
    // Smooth lane interpolation to prevent teleporting when lane changes
    if (car.visualLane === undefined) car.visualLane = car.lane;
    car.visualLane += (car.lane - car.visualLane) * 0.05;
    
    // 6px lateral stagger for columns
    const lateralOffset = car.visualLane * 6;
    const finalX = pt.x + nx * lateralOffset;
    const finalY = pt.y + ny * lateralOffset;
    
    group.setAttribute('transform', `translate(${finalX}, ${finalY}) rotate(${angle})`);
    

    
    // Counter-rotate the label text so it remains upright
    const text = group.querySelector('.car-label');
    if (text) {
      text.setAttribute('transform', `rotate(${-angle})`);
      // Adjust text position slightly if it's the user car since the pointer is not perfectly symmetrical around center
      if (car.isUser) {
        text.setAttribute('y', '3'); // Center vertically in the rotated space
      }
    }
  });
}
