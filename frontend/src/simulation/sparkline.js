/**
 * sparkline.js — Mini Degradation Curve Sparkline
 * 
 * Tiny canvas chart (240×70) showing the fitted deg curve,
 * current tyre age marker, and pit threshold line.
 */

import { getDegradationDelta } from './strategy.js';

let canvas = null;
let ctx = null;

export function initSparkline() {
  canvas = document.getElementById('sparkline-canvas');
  if (!canvas) return;
  
  // Handle high-DPI displays
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
}

export function drawSparkline(compound, currentAge, maxAge = 35) {
  if (!ctx || !canvas) return;

  const W = canvas.getBoundingClientRect().width;
  const H = canvas.getBoundingClientRect().height;
  const pad = { top: 8, right: 10, bottom: 12, left: 10 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Clear
  ctx.clearRect(0, 0, W, H);

  // Compute curve points
  const points = [];
  let maxDelta = 0;
  for (let age = 1; age <= maxAge; age++) {
    const delta = getDegradationDelta(compound, age);
    points.push({ age, delta });
    maxDelta = Math.max(maxDelta, delta);
  }

  const xScale = (age) => pad.left + ((age - 1) / (maxAge - 1)) * plotW;
  const yScale = (delta) => pad.top + plotH - (delta / maxDelta) * plotH;

  // ── Degradation curve ──
  const compoundColors = {
    SOFT: '#ff3333',
    MEDIUM: '#ffd700',
    HARD: '#ffffff',
  };
  const color = compoundColors[compound] || '#00e5ff';

  // Gradient fill under curve
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + plotH);
  gradient.addColorStop(0, color.replace(')', ', 0.15)').replace('rgb', 'rgba'));
  gradient.addColorStop(1, 'transparent');

  ctx.beginPath();
  ctx.moveTo(xScale(1), yScale(0));
  points.forEach(p => ctx.lineTo(xScale(p.age), yScale(p.delta)));
  ctx.lineTo(xScale(maxAge), yScale(0));
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  // Curve line
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xScale(p.age);
    const y = yScale(p.delta);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ── Current position marker ──
  if (currentAge >= 1 && currentAge <= maxAge) {
    const cx = xScale(currentAge);
    const cy = yScale(getDegradationDelta(compound, currentAge));

    // Glow
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fillStyle = `${color}33`;
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();

    // Vertical line
    ctx.strokeStyle = `${color}44`;
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, pad.top);
    ctx.lineTo(cx, pad.top + plotH);
    ctx.stroke();
  }

  // ── Axis labels ──
  ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.font = '6px JetBrains Mono';
  ctx.textAlign = 'left';
  ctx.fillText('1', pad.left, H - 2);
  ctx.textAlign = 'right';
  ctx.fillText(String(maxAge), W - pad.right, H - 2);
  ctx.textAlign = 'center';
  ctx.fillText('TYRE AGE', W / 2, H - 2);
}
