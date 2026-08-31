// track.js - SVG Based 2D Track Renderer (Fashionable Edition)

let svgTrackPath = null;
let svgPitPath = null;
let trackLength = 0;
let pitLength = 0;
let carElements = new Map();
let svgContainer = null;
let currentPitLane = null;
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
  
  svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgContainer.setAttribute('viewBox', '0 0 800 600');
  svgContainer.style.width = '100%';
  svgContainer.style.height = '100%';
  svgContainer.style.overflow = 'visible';
  
  // Define Filters and Gradients
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  
  // Track Glow Filter
  const glowFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  glowFilter.setAttribute('id', 'neonGlow');
  glowFilter.setAttribute('x', '-20%');
  glowFilter.setAttribute('y', '-20%');
  glowFilter.setAttribute('width', '140%');
  glowFilter.setAttribute('height', '140%');
  glowFilter.innerHTML = `
    <feGaussianBlur stdDeviation="8" result="blur" />
    <feComposite in="SourceGraphic" in2="blur" operator="over" />
  `;
  defs.appendChild(glowFilter);

  // Car Shadow Filter
  const shadowFilter = document.createElementNS('http://www.w3.org/2000/svg', 'filter');
  shadowFilter.setAttribute('id', 'carShadow');
  shadowFilter.innerHTML = `
    <feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000" flood-opacity="0.8" />
  `;
  defs.appendChild(shadowFilter);

  // Track Surface Gradient
  const trackGrad = document.createElementNS('http://www.w3.org/2000/svg', 'linearGradient');
  trackGrad.setAttribute('id', 'trackGrad');
  trackGrad.setAttribute('x1', '0%');
  trackGrad.setAttribute('y1', '0%');
  trackGrad.setAttribute('x2', '100%');
  trackGrad.setAttribute('y2', '100%');
  trackGrad.innerHTML = `
    <stop offset="0%" stop-color="#2a2d34" />
    <stop offset="100%" stop-color="#181a20" />
  `;
  defs.appendChild(trackGrad);
  
  svgContainer.appendChild(defs);
  
  const defaultPath = 'M 400,80 C 550,80 650,120 680,200 C 710,280 720,350 700,420 C 680,490 620,530 550,540 C 480,550 420,555 350,540 C 280,525 200,500 150,440 C 100,380 80,300 100,220 C 120,140 200,80 300,75 C 340,73 370,77 400,80 Z';
  const tPath = trackPathD || defaultPath;
  
  // Track Base (Glow / Outline)
  const trackBase = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  trackBase.setAttribute('d', tPath);
  trackBase.setAttribute('fill', 'none');
  trackBase.setAttribute('stroke', 'rgba(0, 229, 255, 0.15)'); // Cyan subtle glow
  trackBase.setAttribute('stroke-width', '34');
  trackBase.setAttribute('filter', 'url(#neonGlow)');
  svgContainer.appendChild(trackBase);
  
  // Track Surface
  svgTrackPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svgTrackPath.setAttribute('d', tPath);
  svgTrackPath.setAttribute('fill', 'none');
  svgTrackPath.setAttribute('stroke', 'url(#trackGrad)');
  svgTrackPath.setAttribute('stroke-width', '28');
  svgContainer.appendChild(svgTrackPath);

  // Track Inner Racing Line (Dashed)
  const racingLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  racingLine.setAttribute('d', tPath);
  racingLine.setAttribute('fill', 'none');
  racingLine.setAttribute('stroke', 'rgba(255, 255, 255, 0.08)');
  racingLine.setAttribute('stroke-width', '2');
  racingLine.setAttribute('stroke-dasharray', '12, 12');
  svgContainer.appendChild(racingLine);
  
  // Start/Finish Line Checkerboard Effect (Simulated with dashes)
  const sfLine1 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  sfLine1.setAttribute('x1', '400');
  sfLine1.setAttribute('y1', '66');
  sfLine1.setAttribute('x2', '400');
  sfLine1.setAttribute('y2', '94');
  sfLine1.setAttribute('stroke', '#fff');
  sfLine1.setAttribute('stroke-width', '4');
  sfLine1.setAttribute('stroke-dasharray', '4, 4');
  svgContainer.appendChild(sfLine1);

  const sfLine2 = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  sfLine2.setAttribute('x1', '404');
  sfLine2.setAttribute('y1', '66');
  sfLine2.setAttribute('x2', '404');
  sfLine2.setAttribute('y2', '94');
  sfLine2.setAttribute('stroke', '#fff');
  sfLine2.setAttribute('stroke-width', '4');
  sfLine2.setAttribute('stroke-dasharray', '4, 4');
  sfLine2.setAttribute('stroke-dashoffset', '4'); // Offset checkerboard
  svgContainer.appendChild(sfLine2);
  
  currentPitLane = pitLaneConfig;
  svgPitPath = null;
  
  if (currentPitLane && currentPitLane.centerline) {
    // Pit lane glow
    const pitGlow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pitGlow.setAttribute('d', currentPitLane.centerline);
    pitGlow.setAttribute('fill', 'none');
    pitGlow.setAttribute('stroke', 'rgba(255, 170, 0, 0.3)');
    pitGlow.setAttribute('stroke-width', '14');
    pitGlow.setAttribute('filter', 'url(#neonGlow)');
    svgContainer.appendChild(pitGlow);

    // Pit lane surface
    svgPitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svgPitPath.setAttribute('d', currentPitLane.centerline);
    svgPitPath.setAttribute('fill', 'none');
    svgPitPath.setAttribute('stroke', '#222');
    svgPitPath.setAttribute('stroke-width', '10');
    svgContainer.appendChild(svgPitPath);

    // Pit lane center line
    const pitCenter = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pitCenter.setAttribute('d', currentPitLane.centerline);
    pitCenter.setAttribute('fill', 'none');
    pitCenter.setAttribute('stroke', '#ffaa00');
    pitCenter.setAttribute('stroke-width', '2');
    pitCenter.setAttribute('stroke-dasharray', '8, 8');
    svgContainer.appendChild(pitCenter);
    
    if (currentPitLane.boxes) {
      currentPitLane.boxes.forEach((box) => {
        boxTargets.set(box.team, box.progress);
      });
    }
  }
  
  containerEl.appendChild(svgContainer);
  
  // Debug text
  window.debugText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  window.debugText.setAttribute('x', '10');
  window.debugText.setAttribute('y', '30');
  window.debugText.setAttribute('fill', 'white');
  window.debugText.setAttribute('font-size', '16px');
  svgContainer.appendChild(window.debugText);
  
  // Get lengths
  trackLength = svgTrackPath.getTotalLength();
  if (svgPitPath) {
    pitLength = svgPitPath.getTotalLength();
  }
  
  return { trackPath: tPath, trackLength: 1.0 };
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
      
      const color = car.color || CAR_COLORS[car.team] || '#ffffff';
      
      if (car.isUser) {
        // User car halo
        const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        halo.setAttribute('r', '18');
        halo.setAttribute('fill', 'none');
        halo.setAttribute('stroke', color);
        halo.setAttribute('stroke-width', '2');
        halo.setAttribute('opacity', '0.5');
        halo.setAttribute('filter', 'url(#neonGlow)');
        group.appendChild(halo);
      }

      // Drop shadow wrapper for car
      const shadowGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      shadowGroup.setAttribute('filter', 'url(#carShadow)');
      
      let shape;
      if (car.isUser) {
        // Create an arrow/pointer for the user car
        // A triangle pointing right: (0,-10), (16,0), (0,10)
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        shape.setAttribute('points', '-6,-10 14,0 -6,10');
        shape.setAttribute('fill', color);
        shape.setAttribute('stroke', '#fff');
        shape.setAttribute('stroke-width', '2');
      } else {
        shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        shape.setAttribute('r', '8');
        shape.setAttribute('fill', color);
        shape.setAttribute('stroke', 'rgba(255,255,255,0.2)');
        shape.setAttribute('stroke-width', '1');
      }
      shadowGroup.appendChild(shape);
      group.appendChild(shadowGroup);
      
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
  if (!trackLength || trackLength === 0) {
    trackLength = svgTrackPath.getTotalLength();
  }
  if (svgPitPath && (!pitLength || pitLength === 0)) {
    pitLength = svgPitPath.getTotalLength();
  }
  
  cars.forEach(car => {
    const group = carElements.get(car.id);
    if (!group) return;
    
    let path = svgTrackPath;
    let t = ((car.progress % 1) + 1) % 1;
    let length = trackLength;
    
    if (car.pitState && svgPitPath) {
      path = svgPitPath;
      t = Math.min(Math.max(car.pitProgress || 0, 0), 1);
      length = pitLength;
    }
    
    t = Math.max(0, Math.min(1, t));
    
    const pt = path.getPointAtLength(t * length);
    
    // Lane offset (crude approximation for SVG)
    let offsetX = 0;
    let offsetY = 0;
    if (car.lane !== 0) {
      // Get tangent to calculate normal
      const pt2 = path.getPointAtLength(Math.min((t * length) + 1, length));
      const dx = pt2.x - pt.x;
      const dy = pt2.y - pt.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 0) {
        const nx = -dy / dist;
        const ny = dx / dist;
        offsetX = nx * car.lane * 5; // 5px per lane
        offsetY = ny * car.lane * 5;
      }
    }
    
    // Calculate rotation angle
    let angle = 0;
    const pt2 = path.getPointAtLength(Math.min((t * length) + 1, length));
    const dx = pt2.x - pt.x;
    const dy = pt2.y - pt.y;
    if (dx !== 0 || dy !== 0) {
      angle = Math.atan2(dy, dx) * 180 / Math.PI;
    }
    
    group.setAttribute('transform', `translate(${pt.x + offsetX}, ${pt.y + offsetY}) rotate(${angle})`);
    
    // Debug info
    if (car.isUser && window.debugText) {
      window.debugText.textContent = `t: ${t.toFixed(4)}, len: ${trackLength}, pt: (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)}), angle: ${angle.toFixed(1)}, dx/dy: ${dx.toFixed(1)}/${dy.toFixed(1)}`;
    }
    
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
