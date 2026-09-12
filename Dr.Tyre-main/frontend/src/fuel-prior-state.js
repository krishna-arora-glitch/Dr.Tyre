/**
 * fuel-prior-state.js — Shared fuel-prior state
 * 
 * Avoids circular dependencies between main.js and research.js
 * by centralizing the active prior state and change callback.
 */

export let activePrior = '0.05';

// Registered callback when prior changes (set by main.js)
let _onChangeCallback = null;

export function setActivePrior(val) {
  activePrior = val;
}

export function registerOnPriorChange(callback) {
  _onChangeCallback = callback;
}

export function firePriorChange(newPrior) {
  setActivePrior(newPrior);
  if (_onChangeCallback) {
    _onChangeCallback(newPrior);
  }
}
