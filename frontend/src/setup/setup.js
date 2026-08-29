import { CIRCUITS } from '../simulation/circuits.js';
import { getFuelBurnRate } from '../simulation/strategy.js';
import { raceConfig } from '../simulation/simulation.js';

export let raceSetup = null;

// DOM Elements
const DOM = {};

function initDOM() {
  DOM.subtitle = document.getElementById('setup-subtitle');
  DOM.ruleset = document.getElementById('setup-ruleset');
  DOM.rulesetDesc = document.getElementById('ruleset-desc');
  
  DOM.tyre = document.getElementById('setup-tyre');
  
  DOM.fuel = document.getElementById('setup-fuel');
  DOM.fuelVal = document.getElementById('setup-fuel-val');
  DOM.fuelMinLabel = document.getElementById('setup-fuel-min-label');
  DOM.fuelRecLabel = document.getElementById('setup-fuel-rec-label');
  
  DOM.aeroDownforce = document.getElementById('setup-aero-downforce');
  DOM.aeroBalance = document.getElementById('setup-aero-balance');
  
  DOM.mechBalance = document.getElementById('setup-mech-balance');
  DOM.brakeBias = document.getElementById('setup-brake-bias');
  
  DOM.energy = document.getElementById('setup-energy');
  
  DOM.legalityPanel = document.getElementById('setup-legality-panel');
  DOM.legalityTitle = document.getElementById('setup-legality-title');
  DOM.legalityList = document.getElementById('setup-legality-list');
  
  DOM.previewSpeed = document.getElementById('preview-speed');
  DOM.previewSpeedBar = document.getElementById('preview-speed-bar');
  DOM.previewGrip = document.getElementById('preview-grip');
  DOM.previewGripBar = document.getElementById('preview-grip-bar');
  DOM.previewWear = document.getElementById('preview-wear');
  DOM.previewWearBar = document.getElementById('preview-wear-bar');
  DOM.previewFuel = document.getElementById('preview-fuel');
  DOM.previewFuelBar = document.getElementById('preview-fuel-bar');
  DOM.previewTradeoff = document.getElementById('preview-tradeoff');
  
  DOM.btnConfirm = document.getElementById('btn-confirm-setup');
}

export function initSetup() {
  if (!DOM.ruleset) {
    initDOM();
    bindEvents();
  }
  
  const circuit = CIRCUITS[raceConfig.trackId];
  if (circuit) {
    DOM.subtitle.textContent = `Prepare the car, tyres and race strategy for ${circuit.name.toUpperCase()} • ${raceConfig.condition}`;
    
    // Calculate minimum fuel needed
    const rawMinFuel = circuit.raceLaps * getFuelBurnRate() * 1.02;
    // Bound the calculated minimum between 70 and 110
    const minFuel = Math.max(70.0, Math.min(110.0, rawMinFuel));
    
    if (DOM.fuelMinLabel) DOM.fuelMinLabel.textContent = rawMinFuel > 110 
      ? `Full Pace Requires: ${rawMinFuel.toFixed(1)} kg (Conservation Required!)` 
      : `Minimum to finish: ${minFuel.toFixed(1)} kg`;
    
    const recFuel = Math.min(110.0, minFuel + (minFuel * 0.05)); // Add 5% safety margin
    if (DOM.fuelRecLabel) DOM.fuelRecLabel.textContent = `Recommended: ${recFuel.toFixed(1)} kg`;
    
    // Set slider to recommended
    DOM.fuel.value = recFuel;
    DOM.fuelVal.textContent = recFuel.toFixed(1);
  }
  
  updateSetupState();
}

function bindEvents() {
  const inputs = [
    DOM.ruleset, DOM.tyre, DOM.fuel, DOM.aeroDownforce, 
    DOM.aeroBalance, DOM.mechBalance, DOM.brakeBias, DOM.energy
  ];
  
  inputs.forEach(input => {
    input.addEventListener('change', updateSetupState);
    if (input.type === 'range') {
      input.addEventListener('input', () => {
        DOM.fuelVal.textContent = parseFloat(input.value).toFixed(1);
        updateSetupState();
      });
    }
  });
  
  DOM.btnConfirm.addEventListener('click', () => {
    if (!DOM.btnConfirm.disabled) {
      // Switch to simulation tab
      document.getElementById('tab-simulation').click();
    }
  });
}

function updateSetupState() {
  const circuit = CIRCUITS[raceConfig.trackId];
  
  // 1. Build raceSetup object
  raceSetup = {
    ruleset: {
      id: DOM.ruleset.value,
      refuellingDuringRace: DOM.ruleset.value === 'F1_CLASSIC_REFUELLING'
    },
    tyres: {
      startingCompound: DOM.tyre.value,
    },
    fuel: {
      startingFuelKg: parseFloat(DOM.fuel.value)
    },
    aerodynamics: {
      downforceLevel: DOM.aeroDownforce.value,
      aeroBalance: DOM.aeroBalance.value
    },
    mechanical: {
      balance: DOM.mechBalance.value,
      brakeBias: DOM.brakeBias.value
    },
    energy: {
      deploymentStrategy: DOM.energy.value
    },
    raceStrategy: {
      expectedStops: 1 // Default to 1 stop implicitly
    }
  };

  // 2. Update Ruleset Description
  if (raceSetup.ruleset.id === 'F1_2026_OFFICIAL') {
    DOM.rulesetDesc.textContent = 'In 2026 rules, fuel must be carried from the start. Refuelling during pit stops is strictly prohibited.';
  } else {
    DOM.rulesetDesc.textContent = 'Classic era rules. Refuelling is permitted during pit stops, allowing lighter starting loads.';
  }

  // 3. Legality Check
  let isLegal = true;
  let legalityHTML = '';
  
  const check = (condition, text, errorText) => {
    if (condition) {
      legalityHTML += `<li style="color:var(--text-primary);"><span style="color:var(--green)">✓</span> ${text}</li>`;
    } else {
      isLegal = false;
      legalityHTML += `<li style="color:var(--red);"><span>✗</span> ${errorText}</li>`;
    }
  };
  
  check(true, `Tyre selection: ${raceSetup.tyres.startingCompound}`);
  
  const rawMinFuel = circuit ? (circuit.raceLaps * getFuelBurnRate() * 1.02) : 110;
  const minFuel = Math.max(70.0, Math.min(110.0, rawMinFuel));
  
  // Fuel legality
  if (!raceSetup.ruleset.refuellingDuringRace) {
    if (rawMinFuel > 110) {
      check(raceSetup.fuel.startingFuelKg === 110, 
        `Fuel load: ${raceSetup.fuel.startingFuelKg} kg (Lift & Coast Required)`, 
        `You must fill the tank to the maximum 110kg because full race pace requires ${rawMinFuel.toFixed(1)}kg.`);
    } else {
      check(raceSetup.fuel.startingFuelKg >= minFuel, 
        `Fuel load: ${raceSetup.fuel.startingFuelKg} kg`, 
        `Fuel load insufficient for race distance (${minFuel.toFixed(1)}kg required). Refuelling banned.`);
    }
  } else {
    check(true, `Fuel load: ${raceSetup.fuel.startingFuelKg} kg (Refuelling allowed)`);
  }
  
  check(true, `Aero configuration: ${raceSetup.aerodynamics.downforceLevel}`);
  
  DOM.legalityList.innerHTML = legalityHTML;
  if (isLegal) {
    DOM.legalityPanel.style.borderTopColor = 'var(--green)';
    DOM.legalityTitle.textContent = '✓ FIA LEGALITY CHECK';
    DOM.legalityTitle.style.color = 'var(--green)';
    DOM.btnConfirm.disabled = false;
  } else {
    DOM.legalityPanel.style.borderTopColor = 'var(--red)';
    DOM.legalityTitle.textContent = '⚠ ILLEGAL SETUP';
    DOM.legalityTitle.style.color = 'var(--red)';
    DOM.btnConfirm.disabled = true;
  }

  // 4. Performance Preview
  updatePerformancePreview();
}

function updatePerformancePreview() {
  let speedScore = 50;
  let gripScore = 50;
  let wearScore = 50;
  let fuelScore = 50;
  let tradeoff = [];
  
  // Aero impacts
  if (raceSetup.aerodynamics.downforceLevel === 'HIGH') {
    speedScore -= 20; gripScore += 20; fuelScore -= 10;
    tradeoff.push("+ High cornering grip, - Lower top speed");
  } else if (raceSetup.aerodynamics.downforceLevel === 'LOW') {
    speedScore += 20; gripScore -= 20; fuelScore += 10; wearScore += 10;
    tradeoff.push("+ High top speed, - Reduced cornering, higher tyre wear");
  } else {
    tradeoff.push("Balanced aerodynamic profile");
  }
  
  // Tyre impacts
  if (raceSetup.tyres.startingCompound === 'SOFT') {
    gripScore += 15; wearScore += 25;
    tradeoff.push("+ Fast initial pace, - High degradation rate");
  } else if (raceSetup.tyres.startingCompound === 'HARD') {
    gripScore -= 10; wearScore -= 20;
    tradeoff.push("+ Long stint life, - Slower warm-up and peak grip");
  }
  
  // Fuel weight impacts
  if (raceSetup.fuel.startingFuelKg > 90) {
    speedScore -= 5; gripScore -= 5; wearScore += 5;
    tradeoff.push("- Heavy car reduces overall agility and accelerates wear");
  } else if (raceSetup.fuel.startingFuelKg < 50) {
    speedScore += 5; gripScore += 5; wearScore -= 5;
    tradeoff.push("+ Light car improves lap times significantly");
  }
  
  // Energy impacts
  if (raceSetup.energy.deploymentStrategy === 'AGGRESSIVE') {
    speedScore += 10; fuelScore -= 10;
  } else if (raceSetup.energy.deploymentStrategy === 'CONSERVATIVE') {
    speedScore -= 5; fuelScore += 10;
  }
  
  // Clamp values
  speedScore = Math.max(10, Math.min(100, speedScore));
  gripScore = Math.max(10, Math.min(100, gripScore));
  wearScore = Math.max(10, Math.min(100, wearScore));
  fuelScore = Math.max(10, Math.min(100, fuelScore));
  
  DOM.previewSpeedBar.style.width = `${speedScore}%`;
  DOM.previewGripBar.style.width = `${gripScore}%`;
  DOM.previewWearBar.style.width = `${wearScore}%`;
  DOM.previewFuelBar.style.width = `${fuelScore}%`;
  
  // Color coding
  DOM.previewSpeedBar.style.background = speedScore > 60 ? 'var(--cyan)' : (speedScore < 40 ? 'var(--amber)' : '#888');
  DOM.previewGripBar.style.background = gripScore > 60 ? 'var(--green)' : (gripScore < 40 ? 'var(--amber)' : '#888');
  DOM.previewWearBar.style.background = wearScore > 60 ? 'var(--red)' : (wearScore < 40 ? 'var(--green)' : '#888');
  DOM.previewFuelBar.style.background = fuelScore > 60 ? 'var(--green)' : (fuelScore < 40 ? 'var(--red)' : '#888');
  
  DOM.previewTradeoff.innerHTML = tradeoff.join('<br>');
}
