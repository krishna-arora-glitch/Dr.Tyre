

export function initTelemetryUI() {
    
}

// Current lap data to prevent completely re-rendering the chart each frame
let currentLapId = null;

export function getLapTelemetry(driverId, lapNumber, telemetryData) {
    if (!telemetryData) return null;
    
    // Map driverId
    let targetDriver = driverId;
    if (driverId === 'USER' || driverId === '11') {
        targetDriver = telemetryData['11'] ? '11' : (telemetryData['VER'] ? 'VER' : Object.keys(telemetryData)[0]);
    } else {
        targetDriver = targetDriver.replace('AI_', '');
        if (!telemetryData[targetDriver]) {
            targetDriver = Object.keys(telemetryData)[0];
        }
    }
    
    if (!targetDriver || !telemetryData[targetDriver]) return null;
    
    const driverLaps = telemetryData[targetDriver];
    const availableLaps = Object.keys(driverLaps).map(Number).sort((a, b) => a - b);
    
    if (availableLaps.length === 0) return null;
    
    const index = (lapNumber - 1) % availableLaps.length;
    let lap = driverLaps[lapNumber.toString()] || driverLaps[availableLaps[index].toString()];
    
    if (lap && lap.length > 0 && lap[0].Time === undefined) {
        lap[0].Time = 0;
        for (let i = 1; i < lap.length; i++) {
            const prev = lap[i - 1];
            const curr = lap[i];
            const tpPrev = prev.track_position_norm || 0;
            const tpCurr = curr.track_position_norm || tpPrev;
            const dDist = Math.max(0, tpCurr - tpPrev) * 5000;
            const sPrev = prev.Speed || 100;
            const sCurr = curr.Speed || 100;
            const avgSpeedKmh = (sPrev + sCurr) / 2;
            let dTime = dDist / (avgSpeedKmh / 3.6);
            if (isNaN(dTime) || dTime < 0) dTime = 0.1; 
            curr.Time = prev.Time + dTime;
        }
    }
    return lap;
}

function normalizeThrottle(val) {
    if (val === null || val === undefined) return { active: null, intensity: null };
    if (typeof val === 'boolean') return { active: val, intensity: null };
    if (val <= 1.0 && val > 0) return { active: val > 0, intensity: val * 100 };
    return { active: val > 0, intensity: Math.max(0, Math.min(100, val)) };
}

function normalizeBrake(val) {
    if (val === null || val === undefined) return { active: null, intensity: null };
    if (typeof val === 'boolean') return { active: val, intensity: null };
    if (val <= 1.0 && val > 0) return { active: val > 0, intensity: val * 100 };
    return { active: val > 0, intensity: Math.max(0, Math.min(100, val)) };
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function deriveMissingPhysics(idx, tel) {
    if (idx < 0) idx = 0;
    if (idx >= tel.length) idx = tel.length - 1;
    let row = tel[idx];
    let prev = idx > 0 ? tel[idx - 1] : null;
    let next = idx < tel.length - 1 ? tel[idx + 1] : null;
    
    let interp = { ...row };
    
    let tNorm = normalizeThrottle(interp.Throttle);
    let bNorm = normalizeBrake(interp.Brake);
    let hasThrottleIntensity = tNorm.intensity !== null;
    let hasBrakeIntensity = bNorm.intensity !== null;
    let hasGear = interp.nGear !== undefined && interp.nGear !== null;
    
    if (hasThrottleIntensity) interp.Throttle = tNorm.intensity;
    if (hasBrakeIntensity) interp.Brake = Math.min(70, bNorm.intensity);
    
    let accel = 0;
    if (next && prev && next.Time > prev.Time) {
        const dSpeedMs = ((next.Speed || 0) - (prev.Speed || 0)) / 3.6;
        const dTime = next.Time - prev.Time;
        accel = dSpeedMs / (dTime || 1); 
    } else if (next && next.Time > interp.Time) {
        const dSpeedMs = ((next.Speed || 0) - (interp.Speed || 0)) / 3.6;
        const dTime = next.Time - interp.Time;
        accel = dSpeedMs / (dTime || 1);
    } else if (prev && interp.Time > prev.Time) {
        const dSpeedMs = ((interp.Speed || 0) - (prev.Speed || 0)) / 3.6;
        const dTime = interp.Time - prev.Time;
        accel = dSpeedMs / (dTime || 1);
    }
    
    const speed = interp.Speed || 0;
    
    // Look-ahead window to find robust target speed
    let lookaheadSteps = Math.min(tel.length - 1 - idx, 12);
    let upcomingMinSpeed = speed;
    if (lookaheadSteps > 0) {
        for (let i = 1; i <= lookaheadSteps; i++) {
            let s = tel[idx + i].Speed;
            if (s !== undefined && s < upcomingMinSpeed) {
                upcomingMinSpeed = s;
            }
        }
    }
    
    let targetSpeed = upcomingMinSpeed;
    
    const isTraffic = interp.traffic > 0.5 && interp.speed_residual_kmh < -10;
    if (isTraffic) {
        targetSpeed -= Math.abs(interp.speed_residual_kmh);
    }
    
    if (!hasBrakeIntensity) {
        let isBraking = bNorm.active === true;
        let b = 0;
        let speedExcess = speed - targetSpeed;
        
        if (speedExcess > 5) {
            // Deceleration required for upcoming corner / traffic
            if (speedExcess > 60) b = 65;
            else if (speedExcess > 40) b = 45;
            else if (speedExcess > 20) b = 25;
            else b = 12;
            
            // Apply mild modifier for actual physical deceleration
            if (accel < -4.0) b += 5;
        } else if (isBraking) {
            b = 8; // Trail braking at apex/corner
        }
        
        interp.Brake = Math.min(70, Math.max(0, b));
    }
    
    if (!hasThrottleIntensity) {
        let t = 0;
        let speedExcess = speed - targetSpeed;
        
        if (interp.Brake > 15) {
            t = 0;
        } else if (speedExcess > 5) {
            t = 15; // Lift throttle
        } else {
            // Speed matches or is below target
            if (accel > 0.5) t = 70 + (accel * 5);
            else if (speed > 250) t = 95;
            else t = 40 + (speed / 300) * 55;
        }
        
        interp.Throttle = Math.min(100, Math.max(0, t));
    }
    
    if (!hasGear) {
        if (speed < 80) interp.nGear = 2;
        else if (speed < 120) interp.nGear = 3;
        else if (speed < 160) interp.nGear = 4;
        else if (speed < 200) interp.nGear = 5;
        else if (speed < 240) interp.nGear = 6;
        else if (speed < 280) interp.nGear = 7;
        else interp.nGear = 8;
    }
    
    return interp;
}

export function getInterpolatedTelemetry(simTime, tel) {
    if (!tel || tel.length === 0) return null;
    if (tel.length === 1) return tel[0];

    // Loop targetTime to simulate laps
    const maxTime = tel[tel.length - 1].Time;
    let targetTime = maxTime > 0 ? simTime % maxTime : 0;
    if (targetTime < 0) targetTime += maxTime;

    let idxA = 0;
    while (idxA < tel.length - 1 && tel[idxA + 1].Time <= targetTime) {
        idxA++;
    }
    
    if (idxA === tel.length - 1) {
        return deriveMissingPhysics(idxA, tel);
    }
    
    const rowA = tel[idxA];
    const rowB = tel[idxA + 1];
    
    // Smooth physics by deriving them AT the exact sample boundaries before interpolating
    const rowA_derived = deriveMissingPhysics(idxA, tel);
    const rowB_derived = deriveMissingPhysics(idxA + 1, tel);
    
    const distRange = rowB.Time - rowA.Time;
    let t = 0;
    if (distRange > 0) {
        t = (targetTime - rowA.Time) / distRange;
    }
    
    const interp = (key) => {
        let valA = rowA_derived[key] !== undefined && rowA_derived[key] !== null ? rowA_derived[key] : 0;
        let valB = rowB_derived[key] !== undefined && rowB_derived[key] !== null ? rowB_derived[key] : valA;
        
        // Handle lap wrap around S/F line for track_position_norm
        if (key === 'track_position_norm') {
            if (valA > 0.9 && valB < 0.1) {
                valB += 1.0; // unwrap forward
            } else if (valA < 0.1 && valB > 0.9) {
                valA += 1.0; // unwrap backward
            }
        }
        
        return lerp(valA, valB, t);
    };
    
    // Track position is inherently relative to S/F line in FastF1, no offset required
    let rawPosition = interp('track_position_norm');
    
    // Wrap strictly into [0, 1) to prevent drawing out of bounds
    rawPosition = rawPosition % 1.0;
    if (rawPosition < 0) rawPosition += 1.0;
    
    const interpolated = {
        Time: targetTime,
        track_position_norm: rawPosition,
        Speed: interp('Speed'),
        ExpectedSpeed: interp('ExpectedSpeed'),
        speed_residual_kmh: interp('speed_residual_kmh'),
        nGear: rowA_derived.nGear,
        DRS: rowA_derived.DRS,
        traffic: rowA_derived.traffic,
        lap_stress: rowA_derived.lap_stress,
        Throttle: interp('Throttle'),
        Brake: interp('Brake')
    };

    return interpolated;
}

export function updateTelemetryUI(car, telemetryData, modelData) {
    if (car) {
        if (car.speed !== undefined && document.getElementById('rc-speed-val')) {
            document.getElementById('rc-speed-val').innerText = Math.round(car.speed);
        }
        if (car.gear !== undefined && document.getElementById('rc-gear-val')) {
            document.getElementById('rc-gear-val').innerText = car.gear;
        }
        if (car.throttle !== undefined && document.getElementById('rc-throttle-val')) {
            document.getElementById('rc-throttle-val').innerText = `${Math.round(car.throttle)}%`;
            if (document.getElementById('rc-throttle-bar')) {
                document.getElementById('rc-throttle-bar').style.width = `${Math.round(car.throttle)}%`;
            }
        }
        if (car.brake !== undefined && document.getElementById('rc-brake-val')) {
            document.getElementById('rc-brake-val').innerText = `${Math.round(car.brake)}%`;
            if (document.getElementById('rc-brake-bar')) {
                document.getElementById('rc-brake-bar').style.width = `${Math.round(car.brake)}%`;
            }
        }
    }

    if (!telemetryData) {
        return;
    }

    const tel = getLapTelemetry(car.id, car.currentLap, telemetryData);

    if (!tel || tel.length === 0) {
        return;
    }

    const simTime = (car.totalRaceTime || 0) - (car.lapStartTime || 0);
    const closestRow = getInterpolatedTelemetry(simTime, tel);
    car.telemetryNorm = closestRow.track_position_norm;
    // Store telemetry row on car for traffic detection in simulation.js
    car.telemetryRow = closestRow;

    // UPDATE DOM — Use shared physics values from car object (computed by trackDynamics.js for ALL cars)
    const actualSpeed = car.speed !== undefined ? car.speed : (closestRow.Speed !== undefined ? closestRow.Speed : null);
    if (actualSpeed !== null) {
        document.getElementById('rc-speed-val').innerText = Math.round(actualSpeed);
    } else {
        document.getElementById('rc-speed-val').innerText = 'N/A';
    }

    const gear = car.gear !== undefined ? car.gear : (closestRow.nGear !== undefined ? closestRow.nGear : null);
    document.getElementById('rc-gear-val').innerText = gear !== null ? gear : 'N/A';

    const drs = closestRow.DRS !== undefined ? closestRow.DRS : null;
    // FastF1 DRS values: 0 = Off, 1 = Off, 8 = Off, 10 = On, 12 = On, 14 = On
    const isDrsOn = drs >= 10;
    document.getElementById('rc-drs-val').innerText = isDrsOn ? 'ON' : 'OFF';
    document.getElementById('rc-drs-val').style.color = isDrsOn ? '#00e5ff' : 'var(--text-muted)';

    // Use shared physics brake/throttle from car object (trackDynamics.js)
    const throttle = car.throttle !== undefined ? car.throttle : (closestRow.Throttle !== undefined ? closestRow.Throttle : 0);
    document.getElementById('rc-throttle-bar').style.width = `${throttle}%`;
    document.getElementById('rc-throttle-val').innerText = `${Math.round(throttle)}%`;

    let brake = car.brake !== undefined ? car.brake : (closestRow.Brake !== undefined ? closestRow.Brake : 0);
    let displayBrake = Math.max(0, brake);
    document.getElementById('rc-brake-bar').style.width = `${displayBrake}%`;
    document.getElementById('rc-brake-val').innerText = `${Math.round(displayBrake)}%`;

    const aero = car.aeroInterference !== undefined ? car.aeroInterference : (closestRow.traffic > 0.5 ? 1.0 : 0);
    const gapSec = car.gapToAheadTime;
    const carAheadNum = car.carAheadNumber;

    if (aero >= 0.65) {
        document.getElementById('rc-live-traffic-status').innerText = (carAheadNum && gapSec !== undefined) ? `DIRTY AIR (#${carAheadNum} ${gapSec.toFixed(1)}s)` : 'DIRTY AIR';
        document.getElementById('rc-live-traffic-status').style.background = 'rgba(239, 68, 68, 0.15)';
        document.getElementById('rc-live-traffic-status').style.color = 'var(--red, #dc2626)';
        document.getElementById('rc-live-traffic-status').style.border = '1px solid var(--red, #dc2626)';
    } else if (aero >= 0.15) {
        document.getElementById('rc-live-traffic-status').innerText = (carAheadNum && gapSec !== undefined) ? `WAKE (#${carAheadNum} ${gapSec.toFixed(1)}s)` : 'WAKE AIR';
        document.getElementById('rc-live-traffic-status').style.background = 'rgba(245, 158, 11, 0.15)';
        document.getElementById('rc-live-traffic-status').style.color = '#d97706';
        document.getElementById('rc-live-traffic-status').style.border = '1px solid #d97706';
    } else {
        document.getElementById('rc-live-traffic-status').innerText = 'CLEAN AIR';
        document.getElementById('rc-live-traffic-status').style.background = 'rgba(0,0,0,0.06)';
        document.getElementById('rc-live-traffic-status').style.color = 'var(--color-carbon, #000)';
        document.getElementById('rc-live-traffic-status').style.border = '1px solid var(--color-carbon, #000)';
    }

    const expSpeed = closestRow.ExpectedSpeed !== undefined ? closestRow.ExpectedSpeed : null;
    document.getElementById('rc-res-actual').innerText = actualSpeed !== null ? `${Math.round(actualSpeed)} km/h` : '--';
    document.getElementById('rc-res-expected').innerText = expSpeed !== null ? `${Math.round(expSpeed)} km/h` : '--';
    
    if (actualSpeed !== null && expSpeed !== null) {
        const diff = actualSpeed - expSpeed;
        const sign = diff > 0 ? '+' : '';
        document.getElementById('rc-res-val').innerText = `${sign}${diff.toFixed(1)} km/h`;
        document.getElementById('rc-res-val').style.color = diff < -5 ? 'var(--red)' : (diff > 5 ? 'var(--green)' : 'var(--color-carbon, #000)');
    }

    // Compute lap stress from speed residuals if not directly available
    let stress = closestRow.lap_stress !== undefined ? closestRow.lap_stress : null;
    if (stress === null && tel.length > 0) {
        // Approximate lap stress: mean absolute speed residual normalized
        // Higher residuals = more deviation from expected = more tyre stress
        let sumAbsResidual = 0;
        let countResidual = 0;
        for (let i = 0; i < tel.length; i++) {
            const r = tel[i].speed_residual_kmh;
            if (r !== undefined && r !== null) {
                sumAbsResidual += Math.abs(r);
                countResidual++;
            }
        }
        if (countResidual > 0) {
            // Normalize: typical residual is ~5-15 km/h, so divide by 20 to get a 0-1 scale
            stress = (sumAbsResidual / countResidual) / 20;
        }
    }
    const stressEl = document.getElementById('rc-stress-val');
    if (stress !== null) {
        stressEl.innerText = stress.toFixed(2);
        // Color code: low < 0.3, medium 0.3-0.7, high > 0.7
        if (stress > 0.7) {
            stressEl.style.color = 'var(--red, #ff3333)';
        } else if (stress > 0.3) {
            stressEl.style.color = 'var(--amber, #ffd700)';
        } else {
            stressEl.style.color = 'var(--green, #00ff88)';
        }
    } else {
        stressEl.innerText = '--';
        stressEl.style.color = '';
    }

    // Update Decomp if available
    updateLapDecomposition(car, modelData);
}

function setTelemetryUnavailable() {
    document.getElementById('rc-speed-val').innerText = 'N/A';
    document.getElementById('rc-gear-val').innerText = 'N/A';
    document.getElementById('rc-throttle-bar').style.width = '0%';
    document.getElementById('rc-throttle-val').innerText = 'N/A';
    document.getElementById('rc-brake-bar').style.width = '0%';
    document.getElementById('rc-brake-val').innerText = 'N/A';
    document.getElementById('rc-drs-val').innerText = 'N/A';
    document.getElementById('rc-live-traffic-status').innerText = 'NO TELEMETRY';
    document.getElementById('rc-live-traffic-status').style.color = '#888';
    document.getElementById('rc-res-actual').innerText = '--';
    document.getElementById('rc-res-expected').innerText = '--';
    document.getElementById('rc-res-val').innerText = '--';
    document.getElementById('rc-stress-val').innerText = '--';
}

function updateLapDecomposition(car, modelData) {
    if (!modelData || !modelData.compounds || !modelData.compounds[car.compound]) return;
    
    const model = modelData.compounds[car.compound];
    if (!model) return;

    const base = model.base_pace || 90.0;
    const tyreDeg = (model.deg_linear || 0.05) * car.tyreAge;
    
    // Simplistic reconstruction for display
    const fuelRemaining = 110 - (car.currentLap * 1.77);
    const priorStr = window.getCurrentFuelPrior ? window.getCurrentFuelPrior() : "0.05";
    const fuelEffect = (fuelRemaining - 55) * parseFloat(priorStr);
    
    const trackEvol = car.currentLap * -0.05; // Approximation based on synthetic
    
    const thermalPenalty = (car.thermalPenalty !== undefined && !isNaN(car.thermalPenalty)) ? car.thermalPenalty : 0.0;

    // Find expected lap time
    const expected = base + tyreDeg + thermalPenalty + fuelEffect + trackEvol;
    
    // Get actual if available
    let total = expected;
    let trafficDelay = 0;
    
    // In simulation.js, car.lastLapTime is available
    if (car.lastLapTime) {
        total = car.lastLapTime;
        trafficDelay = total - expected;
    }

    document.getElementById('lap-decomp-base').innerText = base.toFixed(2) + 's';
    
    const fStr = fuelEffect > 0 ? `+${fuelEffect.toFixed(2)}` : fuelEffect.toFixed(2);
    document.getElementById('lap-decomp-fuel').innerText = fStr + 's';
    
    const tStr = trackEvol > 0 ? `+${trackEvol.toFixed(2)}` : trackEvol.toFixed(2);
    document.getElementById('lap-decomp-track').innerText = tStr + 's';
    
    document.getElementById('lap-decomp-tyre').innerText = `+${tyreDeg.toFixed(2)}s`;
    
    const thermalEl = document.getElementById('lap-decomp-thermal');
    if (thermalEl) {
        thermalEl.innerText = thermalPenalty > 0.001 ? `+${thermalPenalty.toFixed(2)}s` : '+0.00s';
    }
    
    if (car.lastLapTime) {
        const tfStr = trafficDelay > 0 ? `+${trafficDelay.toFixed(2)}` : trafficDelay.toFixed(2);
        document.getElementById('lap-decomp-traffic').innerText = tfStr + 's';
        document.getElementById('lap-decomp-total').innerText = total.toFixed(2) + 's';
    } else {
        document.getElementById('lap-decomp-traffic').innerText = 'Live...';
        document.getElementById('lap-decomp-total').innerText = 'Live...';
    }
}
