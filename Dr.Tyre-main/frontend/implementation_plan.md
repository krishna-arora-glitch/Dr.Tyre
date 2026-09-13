# End-to-End Integration Audit & Implementation Plan

## User Review Required
> [!IMPORTANT]
> The audit identifies that several advanced features recently added to the Python model (like Fuel active prior, Traffic, Quadratic Degradation) are exported into `model_output.json` but are either partially disconnected or completely ignored by the JavaScript simulation engine, which is still using hardcoded variables. This plan outlines a phased approach to completely wire the frontend UI, simulation physics, and pit-strategy engine to the actual Dr.Tyre LME models without breaking existing functionalities.

## Open Questions
- The Backend currently exports `validation.metrics.mae: 0` and `n_laps_validated: 0` because no test laps were kept, or the test filter aggressively threw them all out. Should the frontend validation tab gracefully handle `n_laps_validated == 0` without hiding the entire page?
- Do you want LapStress to be used inside `strategy.js` beyond just explanatory display?

## The Integration Audit

| FEATURE | BACKEND OUTPUT | JSON FIELD | FRONTEND CONSUMER | SIMULATION CONSUMER | STRATEGY CONSUMER | UI | CONNECTED? |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Base Pace** | LME `fresh_pace` | `base_pace` | `competitorsPage.js` | `generateGrid()` (AI Pace) | Uses circuit default | `Pace Loss (Est)` | 🟡 PARTIALLY CONNECTED |
| **Fuel Correction** | `fuel_model.py` prior | `sensitivity_grid[prior]` | `main.js` (slider) | Hardcoded `0.035` in `simulation.js` | N/A | `Fuel Prior Slider` | 🔴 DISCONNECTED |
| **Track Evolution** | `track_evolution.py` | `track_evolution.slope_s_per_sec` | `main.js` loads it | Ignored | Ignored | `Track Evol.` Panel | 🔴 DISCONNECTED |
| **Traffic** | `traffic_filter.py` | `traffic_stats` | `main.js` loads it | Used for visual indicator | Ignored by Pit Strategy | `Traffic Delay` | 🔴 DISCONNECTED |
| **LapStress** | `degradation_model.py` | `stress_coef` | None | None | None | None | 🔴 DISCONNECTED |
| **Linear Deg** | LME `TyreLife` Coef | `deg_linear` | `strategy.js` | `getDegradationDelta()` | `evaluate_undercut()` | `Pace Loss` | 🟢 CONNECTED |
| **Deg Uncertainty** | LME Std. Error | `deg_linear_ci` | `strategy.js` | None | None | Ignored | 🔴 DISCONNECTED |
| **Quadratic Deg** | LME `TyreLife_Sq` | `deg_quadratic` | `strategy.js` | `getDegradationDelta()` | `evaluate_undercut()` | None | 🟢 CONNECTED |
| **Tyre Cliff** | Model inflection | `cliff_lap` | None | None | None | None | 🔴 DISCONNECTED |
| **Random Effect** | Driver Intercepts | None | None | None | None | None | 🔴 DISCONNECTED |
| **Compound Model**| `models[compound]` | `compounds[C]` | `strategy.js` | `getDegradationDelta()` | `evaluate_undercut()` | `Pace Loss` | 🟢 CONNECTED |
| **Validation** | `race_validation.py` | `validation.metrics` | `validation.js` | None | None | `Model Validation` | 🔴 BROKEN (Fails to render) |
| **Cross-Circuit** | `fetch_data.py` | `race_info.track` | `main.js` | `CIRCUITS` constant | `trackMultiplier` | `Setup Header` | 🟢 CONNECTED |
| **Competitor Twin**| Pace offset/Gap | `base_pace` | `competitors.js` | `generateGrid()` | `evaluate_undercut()` | `Competitors` | 🟡 PARTIALLY CONNECTED |
| **Counterfactual** | Sliders | `sensitivity_grid` | `main.js` | Slider updates state | Recalculates dynamically | `Ghost Baseline` | 🟢 CONNECTED |

---

## Proposed Changes

We will implement the fixes in the prioritized order requested.

### P0: Foundation & Core Simulation

#### [MODIFY] `frontend/src/main.js`
- Ensure missing tabs (`competitors`, `validation`, `report`, `story`, `logistics`) initialize safely.
- Fix any unhandled exceptions in tab loading so the content does not remain empty.

#### [MODIFY] `frontend/src/simulation/simulation.js`
- Connect Fuel Model: Replace the hardcoded `FUEL_WEIGHT_PENALTY = 0.035` with the actual LME `activePrior` fuel penalty from `modelData`.
- Connect Track Evolution: Inject `track_evolution.slope_s_per_sec` into the simulation pace math instead of ignoring it.

#### [MODIFY] `frontend/src/simulation/strategy.js`
- Connect Pit Strategy to Traffic: Modify `getRecommendation` to consume telemetry-derived `traffic_stats` to warn when a pit exit re-entry falls into dense traffic.

### P1: Advanced Intelligence

#### [MODIFY] `frontend/src/simulation/strategy.js`
- Connect Uncertainty: Expose the `deg_linear_ci` confidence band inside strategy recommendations (`getDegradationUncertainty`).
- Connect Tyre Cliff: Incorporate the `cliff_lap` (inflection point of quadratic model) as a hard fallback constraint for "PIT NOW".
- Competitor Digital Twins: Ensure `base_pace` offset overrides `baseLapTimeSec` for rival undercut calculations rather than generic circuit baselines.

### P2: Presentation & Tab Restoration

#### [MODIFY] `frontend/src/research/validation.js`
- Gracefully render the Model Validation tab even if `n_laps_validated` evaluates to 0, ensuring `undefined` errors do not hide the tab.

#### [MODIFY] `frontend/src/competitors/competitorsPage.js`
- Update the Competitors page to surface the new Confidence and Tyre Cliff information from the strategy engine.

## Verification Plan

### Automated Tests
- Run `npm run build` after modifications to guarantee the JS module graph compiles without fatal ES6 resolution errors.

### Manual Verification
- Launch Vite UI. Click through all tabs (COMPETITORS, VALIDATION, REPORT) and confirm they render actual DOM content.
- Inspect the Race Control UI: Confirm the "Fuel Effect" dynamically updates based on the user's selected slider, proving the backend prior is driving the simulation.
- Inspect Strategy AI: Ensure the traffic logic flags "PIT WINDOW (TRAFFIC EXPOSED)" based on actual backend `traffic_stats`.