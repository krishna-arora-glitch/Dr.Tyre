/**
 * regulationTransfer.js — 2026 Physics-Informed Regulation Transfer Layer
 *
 * PURPOSE:
 * Our LME degradation model is trained on 2024 FastF1 telemetry.
 * The 2026 F1 regulations introduce significant vehicle changes:
 *   - Lighter minimum mass (768 kg vs 798 kg)
 *   - Narrower tyres / smaller contact patch (avg 327.5 mm vs 355 mm)
 *   - ~30% less aerodynamic downforce (active aero replaces ground effect)
 *   - ~3× electric torque (350 kW MGU-K vs 120 kW)
 *
 * This module computes a dynamic regulation transfer factor R_2026 that
 * adjusts the 2024-trained baseline degradation for the 2026 vehicle.
 *
 * ARCHITECTURE:
 *   2024 LME baseline × (1 + StressFactor) × R_2026 + ThermalPenalty
 *                                              ↑ THIS MODULE
 *
 * R_2026 = 1.0 + Σ(w_i × Δ_i)  where each Δ represents a normalized
 * deviation between the 2024 reference vehicle and the 2026 specification.
 *
 * The factor is bounded: R_2026 ∈ [MIN_FACTOR, MAX_FACTOR]
 *
 * ANTI-DOUBLE-COUNTING:
 * LapStress already feeds into StressFactor (which multiplies BaseAgeDeg).
 * This module uses LapStress ONLY as a cross-term modulator for the tyre-width
 * penalty — representing how much the narrower 2026 contact patch amplifies
 * mechanical sliding. It does NOT duplicate the stress effect on baseline degradation.
 */

// ═══════════════════════════════════════════════════════════════════
// CONFIGURABLE REGULATION CONSTANTS
// All 2024 → 2026 regulation parameters in one place for easy tuning.
// ═══════════════════════════════════════════════════════════════════

export const REGULATION_2026_CONFIG = {
  // ── Vehicle Mass ──
  REFERENCE_MASS_2024_KG: 798,        // 2024 FIA minimum mass
  TARGET_MASS_2026_KG: 768,           // 2026 FIA minimum mass

  // ── Tyre Width (average of front + rear) ──
  REFERENCE_TYRE_WIDTH_AVG_MM: 355,   // 2024: (305 + 405) / 2
  TARGET_TYRE_WIDTH_AVG_MM: 327.5,    // 2026: (280 + 375) / 2

  // ── Aerodynamic Downforce (normalized ratio) ──
  REFERENCE_DOWNFORCE_2024: 1.0,      // 2024 ground-effect = baseline
  TARGET_DOWNFORCE_2026: 0.70,        // 2026 ≈ 30% downforce reduction

  // ── Electric Power Unit ──
  REFERENCE_ELECTRIC_KW_2024: 120,    // 2024 MGU-K output (kW)
  TARGET_ELECTRIC_KW_2026: 350,       // 2026 MGU-K output (kW)

  // ── Component Weights (sum to 1.0) ──
  // Each weight controls how much that physical factor contributes to R_2026
  W_MASS: 0.15,           // Lighter car → slightly less contact force
  W_TYRE_WIDTH: 0.25,     // Narrower rubber → higher contact pressure (N/mm²)
  W_AERO: 0.25,           // Less downforce → more mechanical sliding at apex
  W_TRACTION: 0.20,       // Higher electric torque → more rear tyre stress
  W_SLIDING: 0.15,        // Cross-term: width penalty amplified under load

  // ── Compound Sensitivity Modifiers ──
  // Softer compounds with thinner tread are marginally more sensitive
  // to contact-patch changes than harder compounds.
  COMPOUND_SENSITIVITY: {
    SOFT: 1.03,            // +3% sensitivity to regulation changes
    MEDIUM: 1.00,          // Baseline
    HARD: 0.97,            // -3% sensitivity
  },

  // ── Global Bounds ──
  MIN_FACTOR: 0.90,        // Floor: regulation cannot reduce degradation below 90%
  MAX_FACTOR: 1.35,        // Ceiling: regulation cannot amplify degradation above 135%
};

// ═══════════════════════════════════════════════════════════════════
// HELPER: Encode setup.downforceLevel to normalized [0, 1] scale
// 0 = LOW (least downforce), 0.5 = MEDIUM, 1.0 = HIGH (most downforce)
// ═══════════════════════════════════════════════════════════════════

function normalizeDownforce(setup) {
  if (!setup) return 0.5; // Default MEDIUM
  const level = setup.downforceLevel || 'MEDIUM';
  if (level === 'HIGH') return 1.0;
  if (level === 'LOW') return 0.0;
  return 0.5; // MEDIUM
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Encode energy deployment strategy to normalized [0, 1] scale
// 0 = CONSERVATIVE (gentle torque), 0.5 = BALANCED, 1.0 = AGGRESSIVE (max torque)
// ═══════════════════════════════════════════════════════════════════

function normalizeEnergyDeployment(setup) {
  if (!setup) return 0.5; // Default BALANCED
  const strategy = setup.energy?.deploymentStrategy || setup.deploymentStrategy || 'BALANCED';
  if (strategy === 'AGGRESSIVE') return 1.0;
  if (strategy === 'CONSERVATIVE') return 0.0;
  return 0.5; // BALANCED
}

// ═══════════════════════════════════════════════════════════════════
// MAIN FUNCTION: calculateRegulationTransferFactor
//
// Computes R_2026 = 1.0 + Σ(w_i × Δ_i) where:
//   Δ_mass     = (targetMass / refMass) - 1.0        → negative (lighter)
//   Δ_width    = (refWidth / targetWidth) - 1.0      → positive (narrower)
//   Δ_aero     = f(setup.downforce, target vs ref)   → positive (less downforce)
//   Δ_traction = f(energy deployment, target vs ref) → positive (more torque)
//   Δ_sliding  = width_delta × lapStress_factor      → cross-term
//
// Returns: { factor: number, components: { mass, tyreWidth, aero, traction, sliding } }
// ═══════════════════════════════════════════════════════════════════

export function calculateRegulationTransferFactor(setup = null, lapStress = 0.0, aeroInterference = 0.0, compound = 'MEDIUM') {
  const C = REGULATION_2026_CONFIG;

  // ── 1. MASS COMPONENT ──
  // Lighter car = less vertical force pressing tyres into tarmac = slightly less wear
  // Δ_mass is negative because TARGET < REFERENCE
  const massRatio = C.TARGET_MASS_2026_KG / C.REFERENCE_MASS_2024_KG;
  const delta_mass = massRatio - 1.0; // ≈ -0.0376

  // ── 2. TYRE WIDTH / CONTACT PATCH COMPONENT ──
  // Narrower tyres = higher contact pressure (force per unit area)
  // Same vertical load over smaller area → more surface stress → more wear
  // Δ_width is positive because REFERENCE > TARGET (inverted ratio)
  const widthRatio = C.REFERENCE_TYRE_WIDTH_AVG_MM / C.TARGET_TYRE_WIDTH_AVG_MM;
  const delta_width = widthRatio - 1.0; // ≈ +0.0840

  // ── 3. AERODYNAMIC DOWNFORCE COMPONENT ──
  // 2026 cars have ~30% less downforce baseline.
  // The car's actual setup modulates how much of that deficit is felt:
  //   HIGH downforce setup → partially compensates → less sliding penalty
  //   LOW downforce setup  → amplifies the deficit → more sliding penalty
  //
  // Compute the car's effective downforce relative to the 2024 reference:
  //   effectiveDF = target_2026 + setup_modifier
  // where setup_modifier maps [0,1] normalized downforce to [-0.10, +0.10]
  const normalizedDF = normalizeDownforce(setup);
  const setupAeroModifier = (normalizedDF - 0.5) * 0.20; // ±0.10
  const effectiveDownforce = C.TARGET_DOWNFORCE_2026 + setupAeroModifier;
  // Delta relative to 2024 reference: lower effective DF → positive delta → more wear
  const delta_aero = Math.max(0, (C.REFERENCE_DOWNFORCE_2024 - effectiveDownforce) * 0.75);
  // The 0.75 scaling produces physically realistic sliding penalty magnitude

  // ── 4. TRACTION / ELECTRIC TORQUE COMPONENT ──
  // 2026 MGU-K delivers ~3× the torque of 2024.
  // Higher torque → more longitudinal shear stress on rear tyres.
  // The driver's energy deployment strategy modulates how aggressively this is applied.
  //
  // Base torque delta (2026 vs 2024 reference):
  const torqueRatio = C.TARGET_ELECTRIC_KW_2026 / C.REFERENCE_ELECTRIC_KW_2024; // ≈ 2.917
  const baseTorqueDelta = (torqueRatio - 1.0) * 0.065; // Scaled to realistic rear-tyre shear (≈0.125)
  // Energy deployment modulates: AGGRESSIVE = full effect, CONSERVATIVE = 40% effect
  const normalizedEnergy = normalizeEnergyDeployment(setup);
  const energyModulator = 0.4 + 0.6 * normalizedEnergy; // Range [0.4, 1.0]
  const delta_traction = baseTorqueDelta * energyModulator;

  // ── 5. SLIDING / MECHANICAL CROSS-TERM COMPONENT ──
  // This is NOT a duplication of LapStress in the base degradation model.
  // It represents how the narrower 2026 contact patch AMPLIFIES mechanical
  // sliding under load. High lap stress on a narrower tyre creates
  // disproportionately more surface micro-tearing than on a wider 2024 tyre.
  //
  // Cross-term: width_delta × normalized_lapStress
  // lapStress typically ranges from -0.5 to +1.5 in the simulation.
  // We normalize it to [0, 1] and use it to modulate the width penalty.
  const normalizedStress = Math.max(0, Math.min(1.0, (lapStress + 0.5) / 2.0));
  // Dirty air amplifies sliding slightly (aero interference [0, 1])
  const trafficAmplifier = 1.0 + 0.15 * Math.min(1.0, aeroInterference);
  const delta_sliding = delta_width * normalizedStress * trafficAmplifier;

  // ── 6. COMPOUND SENSITIVITY ──
  const compoundMod = C.COMPOUND_SENSITIVITY[compound] || 1.0;

  // ── 7. WEIGHTED SUM ──
  const rawDelta = (
    C.W_MASS * delta_mass +
    C.W_TYRE_WIDTH * delta_width +
    C.W_AERO * delta_aero +
    C.W_TRACTION * delta_traction +
    C.W_SLIDING * delta_sliding
  );

  const rawFactor = 1.0 + rawDelta * compoundMod;

  // ── 8. CLAMP TO BOUNDS ──
  const factor = Math.max(C.MIN_FACTOR, Math.min(C.MAX_FACTOR, rawFactor));

  return {
    factor,
    components: {
      mass: C.W_MASS * delta_mass,
      tyreWidth: C.W_TYRE_WIDTH * delta_width,
      aero: C.W_AERO * delta_aero,
      traction: C.W_TRACTION * delta_traction,
      sliding: C.W_SLIDING * delta_sliding,
    }
  };
}
