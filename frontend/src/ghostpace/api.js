const API_BASE = 'http://localhost:8000/api/v1';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  getSessions: () => fetchJSON(`${API_BASE}/sessions`),

  getSessionStats: (sessionId) =>
    fetchJSON(`${API_BASE}/sessions/${sessionId}/stats`),

  getIntelligence: (sessionId, fuelPrior = 0.05) =>
    fetchJSON(`${API_BASE}/intelligence/${sessionId}?fuel_prior=${fuelPrior}`),

  getGhostBaseline: (sessionId, driverId, fuelPrior = 0.05) =>
    fetchJSON(`${API_BASE}/ghost-baseline/${sessionId}/${driverId}?fuel_prior=${fuelPrior}`),

  getSensitivity: (sessionId) =>
    fetchJSON(`${API_BASE}/sensitivity/${sessionId}`),

  getCalibration: (sessionId, driverId, k = 2, fuelPrior = 0.05) =>
    fetchJSON(`${API_BASE}/calibration/${sessionId}/${driverId}?k=${k}&fuel_prior=${fuelPrior}`),

  getOracleValidation: (track) =>
    fetchJSON(`${API_BASE}/oracle-validation/${track}`),

  healthCheck: () => fetchJSON(`${API_BASE}/health`),
};
