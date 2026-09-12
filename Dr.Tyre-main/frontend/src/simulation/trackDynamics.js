/**
 * trackDynamics.js — Telemetry-Derived Track Dynamics Profile
 * 
 * Precomputes a reusable track profile from FastF1 telemetry (ExpectedSpeed vs track_position_norm).
 * Exposes a shared physics evaluator that any car can call to get its brake/throttle/speed/gear
 * based purely on its current track position, speed, and traffic state.
 *
 * ONE shared physics methodology. TWENTY independent cars. NO random braking.
 */

// ── Module State ──
let trackProfile = null;     // Sorted array of { pos, speed } from reference telemetry
let profileReady = false;
let profileAvgSpeed = 160;   // Average profile speed across circuit (km/h)

// ── Constants ──
const BRAKE_GAIN = 1.8;          // Tuned so typical heavy braking zone ≈ 50-65%
const SMOOTHING_ALPHA = 0.35;    // EMA smoothing factor (0 = full smooth, 1 = no smooth)
const LOOK_AHEAD_DISTANCE = 0.12; // Look ahead 12% of track (≈600m on a 5km track)
const MIN_DISTANCE_CLAMP = 0.004; // Minimum distance to prevent divide-by-zero
const MAX_BRAKE = 5;              // Maximum physical brake percentage (capped at 5%)
const TRAFFIC_SPEED_PENALTY = 15; // km/h reduction per unit of traffic factor

// ── Speed-to-gear mapping ──
function speedToGear(speed) {
    if (speed < 80) return 2;
    if (speed < 120) return 3;
    if (speed < 160) return 4;
    if (speed < 200) return 5;
    if (speed < 240) return 6;
    if (speed < 280) return 7;
    return 8;
}

/**
 * Build the track dynamics profile from telemetry data.
 * Called ONCE at race start.
 * 
 * @param {Object} telemetryData - The telemetry dict from model_output JSON ({ driverId: { lapNum: [samples] } })
 */
export function buildTrackProfile(telemetryData) {
    trackProfile = null;
    profileReady = false;

    if (!telemetryData) {
        console.warn('[TrackDynamics] No telemetry data available. Using fallback.');
        buildFallbackProfile();
        return;
    }

    // Find the best reference lap: pick the first driver's first lap that has ExpectedSpeed
    let referenceSamples = null;

    for (const driverId of Object.keys(telemetryData)) {
        const driverLaps = telemetryData[driverId];
        for (const lapNum of Object.keys(driverLaps)) {
            const samples = driverLaps[lapNum];
            if (samples && samples.length > 20) {
                // Check if ExpectedSpeed exists
                const hasExpected = samples.some(s => s.ExpectedSpeed !== undefined && s.ExpectedSpeed !== null);
                if (hasExpected) {
                    referenceSamples = samples;
                    break;
                }
                // Fallback: use Speed if no ExpectedSpeed
                if (!referenceSamples) {
                    referenceSamples = samples;
                }
            }
        }
        if (referenceSamples && referenceSamples.some(s => s.ExpectedSpeed !== undefined)) break;
    }

    if (!referenceSamples || referenceSamples.length === 0) {
        console.warn('[TrackDynamics] No reference lap found. Using fallback.');
        buildFallbackProfile();
        return;
    }

    // Build sorted profile from reference samples
    const raw = [];
    for (const sample of referenceSamples) {
        const pos = sample.track_position_norm;
        // Prefer ExpectedSpeed (clean baseline), fall back to Speed
        const speed = (sample.ExpectedSpeed !== undefined && sample.ExpectedSpeed !== null)
            ? sample.ExpectedSpeed
            : (sample.Speed || 200);
        if (pos !== undefined && pos !== null && speed > 0) {
            raw.push({ pos, speed });
        }
    }

    // Sort by position
    raw.sort((a, b) => a.pos - b.pos);

    if (raw.length < 10) {
        console.warn('[TrackDynamics] Too few samples. Using fallback.');
        buildFallbackProfile();
        return;
    }

    // 11-point moving average to robustly smooth noise in the reference speed profile
    const smoothed = [];
    const WINDOW = 5;
    for (let i = 0; i < raw.length; i++) {
        let sum = 0;
        let count = 0;
        for (let j = -WINDOW; j <= WINDOW; j++) {
            let idx = i + j;
            if (idx >= 0 && idx < raw.length) {
                sum += raw[idx].speed;
                count++;
            }
        }
        smoothed.push({
            pos: raw[i].pos,
            speed: sum / count
        });
    }

    // Precompute look-ahead data for each sample point
    trackProfile = [];
    for (let i = 0; i < smoothed.length; i++) {
        const entry = { ...smoothed[i] };

        // Look ahead circularly to find upcoming minimum speed and distance to it
        let minSpeed = entry.speed;
        let minDist = 0;
        let searched = 0;

        for (let j = 1; j < smoothed.length && searched < LOOK_AHEAD_DISTANCE; j++) {
            const idx = (i + j) % smoothed.length;
            const prevIdx = (i + j - 1) % smoothed.length;

            // Distance between consecutive samples (circular)
            let dPos = smoothed[idx].pos - smoothed[prevIdx].pos;
            if (dPos < -0.5) dPos += 1.0; // wrap
            if (dPos < 0) dPos = 0.001;

            searched += dPos;

            if (smoothed[idx].speed < minSpeed) {
                minSpeed = smoothed[idx].speed;
                minDist = searched;
            }
        }

        entry.upcomingMinSpeed = minSpeed;
        entry.distToMin = Math.max(minDist, MIN_DISTANCE_CLAMP);
        trackProfile.push(entry);
    }

    profileReady = true;
    if (trackProfile && trackProfile.length > 0) {
        const sum = trackProfile.reduce((acc, p) => acc + p.speed, 0);
        profileAvgSpeed = sum / trackProfile.length;
    }
    console.log(`[TrackDynamics] Profile built: ${trackProfile.length} samples. `
        + `Speed range: ${Math.round(Math.min(...trackProfile.map(p => p.speed)))} - ${Math.round(Math.max(...trackProfile.map(p => p.speed)))} km/h. Avg: ${Math.round(profileAvgSpeed)} km/h`);
}

/**
 * Fallback profile for when no telemetry is available.
 * Uses a simple sinusoidal speed profile.
 */
function buildFallbackProfile() {
    trackProfile = [];
    const N = 100;
    for (let i = 0; i < N; i++) {
        const pos = i / N;
        // Sinusoidal speed between 90 and 280 km/h with 4 corners
        const speed = 185 + 95 * Math.sin(pos * Math.PI * 8);
        trackProfile.push({ pos, speed: Math.max(80, Math.min(320, speed)) });
    }

    for (let i = 0; i < trackProfile.length; i++) {
        let minSpeed = trackProfile[i].speed;
        let minDist = 0;
        let searched = 0;

        for (let j = 1; j < trackProfile.length && searched < LOOK_AHEAD_DISTANCE; j++) {
            const idx = (i + j) % trackProfile.length;
            const dPos = 1 / trackProfile.length;
            searched += dPos;

            if (trackProfile[idx].speed < minSpeed) {
                minSpeed = trackProfile[idx].speed;
                minDist = searched;
            }
        }
        trackProfile[i].upcomingMinSpeed = minSpeed;
        trackProfile[i].distToMin = Math.max(minDist, MIN_DISTANCE_CLAMP);
    }

    profileReady = true;
    if (trackProfile && trackProfile.length > 0) {
        const sum = trackProfile.reduce((acc, p) => acc + p.speed, 0);
        profileAvgSpeed = sum / trackProfile.length;
    }
    console.log('[TrackDynamics] Fallback profile built. Avg: ' + Math.round(profileAvgSpeed) + ' km/h');
}

/**
 * Lookup the track profile at a given normalized position.
 * Uses binary search for efficiency.
 * 
 * @param {number} pos - Normalized track position [0, 1)
 * @returns {{ speed: number, upcomingMinSpeed: number, distToMin: number }}
 */
function lookupProfile(pos) {
    if (!trackProfile || trackProfile.length === 0) {
        return { speed: 200, upcomingMinSpeed: 200, distToMin: 0.05 };
    }

    // Wrap position
    pos = ((pos % 1) + 1) % 1;

    // Binary search for the nearest sample
    let lo = 0, hi = trackProfile.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (trackProfile[mid].pos < pos) lo = mid + 1;
        else hi = mid;
    }

    // Interpolate between lo-1 and lo
    const idxB = lo;
    const idxA = lo > 0 ? lo - 1 : trackProfile.length - 1;
    const a = trackProfile[idxA];
    const b = trackProfile[idxB];

    let dPos = b.pos - a.pos;
    if (dPos <= 0) dPos += 1.0;

    let t = (pos - a.pos);
    if (t < 0) t += 1.0;
    t = dPos > 0 ? t / dPos : 0;
    t = Math.max(0, Math.min(1, t));

    return {
        speed: a.speed + (b.speed - a.speed) * t,
        upcomingMinSpeed: a.upcomingMinSpeed + (b.upcomingMinSpeed - a.upcomingMinSpeed) * t,
        distToMin: a.distToMin + (b.distToMin - a.distToMin) * t
    };
}

/**
 * Evaluate braking/throttle physics for a single car.
 * Called every frame for EVERY car (user + AI).
 * 
 * Each car passes its own state; the function returns independent results.
 *
 * @param {number} trackPos       - Car's current normalized track position [0, 1)
 * @param {number} prevBrake      - Car's brake value from the previous frame (for EMA smoothing)
 * @param {number} prevThrottle   - Car's throttle value from the previous frame (for EMA smoothing)
 * @param {number} trafficFactor  - 0 = clean air, 1 = heavy traffic (reduces target speed)
 * @returns {{ speed: number, brake: number, throttle: number, gear: number, targetSpeed: number, distanceToTarget: number, speedExcess: number }}
 */
export function evaluateCarPhysics(trackPos, currentSimSpeed, prevBrake = 0, prevThrottle = 80, trafficFactor = 0) {
    if (!profileReady) {
        return { speed: currentSimSpeed, brake: 0, throttle: 80, gear: 6, targetSpeed: 200, distanceToTarget: 0.05, speedExcess: 0 };
    }

    const profile = lookupProfile(trackPos);

    // High-speed section factor: dirty air primarily affects high-speed performance
    const highSpeedFactor = Math.min(1.0, Math.max(0, (profile.speed - 160) / 160.0));
    
    // Support continuous aerodynamic penalty factor
    const aeroPenalty = (trafficFactor > 0.1 && trafficFactor <= 1.0) ? (trafficFactor * 0.025) : (trafficFactor || 0);
    const effectivePenalty = aeroPenalty * highSpeedFactor;

    // Target speed is smoothly reduced in high-speed zones by aerodynamic interference
    let targetSpeed = profile.speed * (1.0 - effectivePenalty);
    targetSpeed = Math.max(60, targetSpeed); // Floor

    const speedExcess = currentSimSpeed - targetSpeed;
    const distanceToTarget = profile.distToMin;

    // ── Brake Demand ──
    let rawBrake = 0;
    if (speedExcess > 1) {
        // We are going faster than the smooth telemetry profile, need to brake
        rawBrake = Math.min(MAX_BRAKE, speedExcess * 0.5); 
    }

    // EMA smooth the brake signal to prevent jitter
    const brake = Math.max(0, Math.min(MAX_BRAKE, 
        prevBrake + SMOOTHING_ALPHA * (rawBrake - prevBrake)
    ));

    // ── Throttle Demand ──
    let rawThrottle;
    if (brake > 0.5) {
        // Braking: throttle drops
        rawThrottle = Math.max(90, 95 - brake); 
    } else if (speedExcess > 1) {
        // Coasting / slightly over target
        rawThrottle = Math.max(90, 99 - speedExcess);
    } else if (speedExcess < -3) {
        // Need to accelerate to catch up to target
        rawThrottle = 100;
    } else {
        // Maintaining target speed smoothly
        rawThrottle = 95 + (Math.abs(speedExcess) / 3) * 5;
    }

    // EMA smooth throttle
    const throttle = Math.max(90, Math.min(100,
        prevThrottle + SMOOTHING_ALPHA * (rawThrottle - prevThrottle)
    ));

    const gear = speedToGear(currentSimSpeed);

    return {
        brake: Math.round(brake * 10) / 10,
        throttle: Math.round(throttle * 10) / 10,
        gear,
        targetSpeed: Math.round(targetSpeed),
        distanceToTarget: Math.round(distanceToTarget * 10000) / 10000,
        speedExcess: Math.round(speedExcess * 10) / 10
    };
}

/**
 * Check if the track profile is ready.
 */
export function isProfileReady() {
    return profileReady;
}

/**
 * Get the full precomputed profile for diagnostics.
 */
export function getTrackProfile() {
    return trackProfile;
}

/**
 * Get the precomputed average speed of the profile across the circuit.
 */
export function getProfileAvgSpeed() {
    return profileAvgSpeed || 160;
}
