const { getInterpolatedTelemetry } = require('./src/simulation/telemetry-ui.js');

const mockTel = [
    { Time: 0.0, track_position_norm: 0.0 },
    { Time: 1.0, track_position_norm: 0.1 },
    { Time: 8.0, track_position_norm: 0.8 },
    { Time: 9.0, track_position_norm: 0.9 },
    { Time: 9.8, track_position_norm: 0.98 },
    { Time: 10.2, track_position_norm: 0.02 }, // Simulates boundary wrap (Time keeps going but norm resets)
    { Time: 11.0, track_position_norm: 0.1 }
];

console.log('--- TESTING INTERPOLATION AT BOUNDARY ---');
// We want to interpolate exactly at Time = 10.0 (middle of the boundary 9.8s -> 10.2s)
// The position should be exactly (0.98 + 1.02)/2 = 1.0 -> wrapped to 0.0

const times = [9.7, 9.8, 9.9, 10.0, 10.1, 10.2, 10.3];
times.forEach(t => {
    const interp = getInterpolatedTelemetry(t, mockTel);
    console.log(`Time: ${t.toFixed(1)} -> track_position_norm: ${interp.track_position_norm.toFixed(4)}`);
});
