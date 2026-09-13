export const BASE_GRIP = 1.0;
export const MAX_RUBBER_GAIN = 0.15; // Max 15% grip improvement
export const RUBBER_DEPOSIT_RATE = 0.005; // Per car per lap
export const TRACK_TEMP_TARGET = 35; // Target track temp in C

let state = {
  trackRubber: 0,
  trackGrip: BASE_GRIP,
  trackTemperature: 30, // Starts cooler
  airTemperature: 28,
  lap: 0
};

export function initTrackState(initialAir = 28, initialTrack = 30) {
  state = {
    trackRubber: 0,
    trackGrip: BASE_GRIP,
    trackTemperature: initialTrack,
    airTemperature: initialAir,
    lap: 0
  };
}

export function updateTrackState(cars, currentLap) {
  if (currentLap <= state.lap) return; // Prevent double updating
  
  const trafficCount = cars ? cars.length : 20;
  
  // Rubber deposits linearly with cars, but grip increases logarithmically (saturation)
  state.trackRubber += RUBBER_DEPOSIT_RATE * trafficCount;
  
  // k is the steepness of the saturation curve
  const k = 0.05;
  state.trackGrip = BASE_GRIP + MAX_RUBBER_GAIN * (1 - Math.exp(-k * state.trackRubber));
  
  // Temperature approaches target using Newton's law of cooling / solar heating
  const coolingRate = 0.1;
  state.trackTemperature += (TRACK_TEMP_TARGET - state.trackTemperature) * coolingRate;
  
  state.lap = currentLap;
}

export function getLiveTrackState() {
  return { ...state };
}

export function projectTrackState(currentLap, futureLap) {
  const lapsAhead = futureLap - currentLap;
  if (lapsAhead <= 0) return getLiveTrackState();
  
  // Project rubber and grip
  const projectedRubber = state.trackRubber + (RUBBER_DEPOSIT_RATE * 20 * lapsAhead);
  const k = 0.05;
  const projectedGrip = BASE_GRIP + MAX_RUBBER_GAIN * (1 - Math.exp(-k * projectedRubber));
  
  // Project temperature (asymptotic approach to target)
  const coolingRate = 0.1;
  const decay = Math.pow(1 - coolingRate, lapsAhead);
  const projectedTemp = TRACK_TEMP_TARGET - (TRACK_TEMP_TARGET - state.trackTemperature) * decay;
  
  return {
    trackRubber: projectedRubber,
    trackGrip: projectedGrip,
    trackTemperature: projectedTemp,
    airTemperature: state.airTemperature,
    lap: futureLap
  };
}