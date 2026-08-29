import * as THREE from 'three';
import { buildTrackFromGPS } from './TrackBuilder.js';

let scene, camera, renderer;
let trackCurve = null;
let pitCurve = null;
let currentPitLane = null;
const boxTargets = new Map();
let carMeshes = new Map(); // id -> THREE.Group
let animationFrameId = null;

const CAR_COLORS = {
  'Red Bull': 0x0600ef,
  'Mercedes': 0x00d2be,
  'Ferrari': 0xdc0000,
  'McLaren': 0xff8700,
  'Aston Martin': 0x006f62,
  'Alpine': 0x0090ff,
  'Williams': 0x005aff,
  'RB': 0x6692ff,
  'Sauber': 0x00e701,
  'Haas': 0xffffff
};

export function getPitLaneConfig() {
  return currentPitLane;
}

export function getPitBoxTarget(teamName) {
  return boxTargets.has(teamName) ? boxTargets.get(teamName) : 0.5;
}

// Helper to convert SVG path string to an array of 2D points
function samplePathToPoints(pathD, numPoints = 200) {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  const path = document.createElementNS(svgNS, 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  document.body.appendChild(svg); // Must be in DOM to get length

  const length = path.getTotalLength();
  const points = [];
  for (let i = 0; i < numPoints; i++) {
    const pt = path.getPointAtLength((i / numPoints) * length);
    points.push({ x: pt.x, y: pt.y });
  }

  document.body.removeChild(svg);
  return points;
}

export function initTrack(containerEl, trackPathD = null, pitLaneConfig = null) {
  // Clean up previous
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  containerEl.innerHTML = '';
  carMeshes.clear();
  boxTargets.clear();

  const width = containerEl.clientWidth || 800;
  const height = containerEl.clientHeight || 600;

  // 1. Setup Three.js Scene
  scene = new THREE.Scene();
  // scene.background = new THREE.Color(0x1a1a1a); // Transparent background
  
  // Lighting
  const ambient = new THREE.AmbientLight(0xffffff, 1.5);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 2.0);
  dirLight.position.set(10, 10, 20);
  scene.add(dirLight);

  // Camera (Isometric angle)
  const aspect = width / height;
  const d = 10; // Reduced from 15 to make track look bigger
  camera = new THREE.OrthographicCamera(-d * aspect, d * aspect, d, -d, 1, 1000);
  camera.position.set(0, -20, 20);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0); // fully transparent
  renderer.setSize(width, height);
  renderer.setPixelRatio(window.devicePixelRatio);
  containerEl.appendChild(renderer.domElement);

  // Default path if none provided
  const tPath = trackPathD || 'M 400,80 C 550,80 650,120 680,200 C 710,280 720,350 700,420 C 680,490 620,530 550,540 C 480,550 420,555 350,540 C 280,525 200,500 150,440 C 100,380 80,300 100,220 C 120,140 200,80 300,75 C 340,73 370,77 400,80 Z';

  // 2. Generate Track GPS Points
  const rawGPSPoints = samplePathToPoints(tPath, 400);

  // 3. Build 3D Track
  // Note: circuitId can be passed in later, for now we pass null
  const buildResult = buildTrackFromGPS(rawGPSPoints, null);
  if (buildResult && buildResult.group) {
    scene.add(buildResult.group);
    trackCurve = buildResult.curve;
  }

  // 4. Setup Pit Lane
  currentPitLane = pitLaneConfig;
  pitCurve = null;
  if (currentPitLane && currentPitLane.centerline) {
    const pitPoints = samplePathToPoints(currentPitLane.centerline, 100);
    if (buildResult.center && buildResult.scale) {
       const pts3D = pitPoints.map(p => new THREE.Vector3(
         (p.x - buildResult.center.x) * buildResult.scale,
         -(p.y - buildResult.center.y) * buildResult.scale, // INVERTED Y TO MATCH TRACK BUILDER
         0.05 // slightly above ground
       ));
       pitCurve = new THREE.CatmullRomCurve3(pts3D, false, "catmullrom", 0.3);

       // Draw a simple line for pit lane
       const geom = new THREE.BufferGeometry().setFromPoints(pitCurve.getSpacedPoints(100));
       const mat = new THREE.LineDashedMaterial({ color: 0xffaa00, dashSize: 0.5, gapSize: 0.5 });
       const line = new THREE.Line(geom, mat);
       line.computeLineDistances();
       scene.add(line);
    }
    
    if (currentPitLane.boxes) {
      currentPitLane.boxes.forEach((box) => {
        boxTargets.set(box.team, box.progress);
      });
    }
  }

  // Handle Resize
  window.addEventListener('resize', onWindowResize);

  function onWindowResize() {
    if (!containerEl) return;
    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;
    const aspect = w / h;
    camera.left = -d * aspect;
    camera.right = d * aspect;
    camera.top = d;
    camera.bottom = -d;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  // Animation Loop
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }
  animate();

  // Return structure compatible with previous implementation
  return { trackPath: null, trackLength: 1.0 }; 
}

export function syncCarsToSVG(cars, svgEl) {
  // Rename function concept: syncCarsTo3D
  const carIds = new Set(cars.map(c => c.id));
  
  // Remove cars that no longer exist
  for (const [id, group] of carMeshes.entries()) {
    if (!carIds.has(id)) {
      scene.remove(group);
      carMeshes.delete(id);
    }
  }

  // Add new cars
  cars.forEach(car => {
    if (!carMeshes.has(car.id)) {
      const group = new THREE.Group();

      // Car body (small box)
      const color = car.color || CAR_COLORS[car.team] || 0xffffff;
      const geom = new THREE.BoxGeometry(1.2, 0.6, 0.4); // Made bigger
      const mat = new THREE.MeshBasicMaterial({ color: color }); // Removed lighting dependency
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.z = 0.2;
      group.add(mesh);

      // Glow for user
      if (car.isUser) {
        const glowGeom = new THREE.CircleGeometry(1.2, 16);
        const glowMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.6, side: THREE.DoubleSide });
        const glow = new THREE.Mesh(glowGeom, glowMat);
        glow.position.z = 0.05;
        group.add(glow);
      }

      // Sprite Label
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = car.isUser ? '#ffffff' : color;
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(car.isUser ? 'P' + car.position : car.number, 128, 48);
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.needsUpdate = true; // Ensure it renders
      const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.set(0, 0, 1.5); // Float directly above car in Z
      sprite.scale.set(4, 1, 1); // Made bigger
      
      sprite.userData.isLabel = true;
      group.add(sprite);

      scene.add(group);
      carMeshes.set(car.id, group);
    } else {
       // Update label text if needed
       const group = carMeshes.get(car.id);
       group.children.forEach(c => {
         if (c.userData.isLabel && car.isUser) {
           const ctx = c.material.map.image.getContext('2d');
           ctx.clearRect(0,0,256,64);
           ctx.fillStyle = '#ffffff';
           ctx.fillText('P' + car.position, 128, 48);
           c.material.map.needsUpdate = true;
         }
       });
    }
  });
}

export function renderCars(cars) { if (Math.random() < 0.01) console.log('renderCars cars:', cars.length, 'meshes:', carMeshes.size);
  if (!trackCurve) return;

  cars.forEach(car => {
    const group = carMeshes.get(car.id);
    if (!group) return;

    let curve = trackCurve;
    let t = ((car.progress % 1) + 1) % 1; // Safely handle negative progress

    if (car.pitState && pitCurve) {
      curve = pitCurve;
      t = Math.min(Math.max(car.pitProgress || 0, 0), 1);
    }

    // Ensure t is strictly between 0 and 1
    t = Math.max(0, Math.min(1, t));

    const pt = curve.getPointAt(t);
    let tangent = curve.getTangentAt(t);
    if (tangent.lengthSq() < 0.000001) tangent = new THREE.Vector3(1,0,0);
    else tangent.normalize();
    
    const normal = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();

    // Lane offset
    if (car.lane !== 0) {
      // In 3D, lane width should be smaller than 6 (which was SVG pixels)
      const laneWidth = 0.3; 
      const offset = car.lane * laneWidth;
      pt.x += normal.x * offset;
      pt.y += normal.y * offset;
    }

    group.position.copy(pt);
    
    // Rotate to face tangent
    const angle = Math.atan2(tangent.y, tangent.x);
    group.rotation.z = angle;

    // Counter-rotate the sprite label so it always faces camera
    group.children.forEach(c => {
      if (c.userData.isLabel) {
        c.rotation.z = -angle;
      }
    });
  });
}
