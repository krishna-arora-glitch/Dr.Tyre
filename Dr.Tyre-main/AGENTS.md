# Project Context: Dr.Tyre (TrackShift 2026)

## 1. Challenge & Problem Statement
- **Theme:** AI Motorsport Intelligence
- **Overview:** Isolating true tyre wear rates from confounding practice variables like fuel weight, traffic, and track evolution.
- **The Goal:** Create a predictive data science model and interactive intelligence platform that strips out external noise from practice sessions to generate clean tyre performance degradation curves (the "Ghost Baseline"). Includes live pit-wall strategy intelligence, post-race validation tools, and a real-world commercial logistics translation lab.

## 2. TrackShift 2026 Core Principles
1. **Constraint is the Design Brief:** Great engineering comes from solving complex problems within real-world constraints, building practical, scalable, and deterministic solutions.
2. **Real-World Impact:** Every solution demonstrates measurable impact, technical feasibility, and the potential to create meaningful outcomes beyond motorsport.
3. **Motorsport as Inspiration:** Apply proven motorsport engineering principles (pit wall intelligence, telemetry deconvolution, thermal management, supply chain traceability) to commercial fleet logistics.

---

## 3. System Architecture & Complete Component Map

### A. Python Data Science Pipeline (`Dr.Tyre-main/pipeline/`)
- `fetch_data.py`: Telemetry ingestion via FastF1 API (2024 Singapore GP FP2 & Race) with an offline realistic synthetic generator fallback (`generate_synthetic_practice`).
- `fuel_model.py`: Stint fuel estimation (short runs: 30kg, long: 55kg, race: 110kg @ 1.77kg/lap). Identifiability check with matrix rank and condition number ($\kappa \le 10^4$). Falls back to physical prior $\alpha_{fuel} = 0.035\text{ s/kg}$ on Singapore street circuit. Normalizes laps to a 55kg reference weight.
- `traffic_filter.py`: 2-step anomaly rejection. Discards out-laps (tyre life 1) & in-laps. 3-lap rolling median MAD filter flags $> 1.0\text{s}$ slowdowns as dirty air.
- `track_evolution.py`: 5-minute session binning, 25th percentile smoothing, and linear trend fitting ($s/\text{sec}$) to remove track rubbering improvement.
- `degradation_model.py`: Linear Mixed Effects (LME) models (`AdjLapTime ~ TyreLife + (1|Driver)`) via `statsmodels` with pre-adjustment ($\lambda_{fuel}=0.05$) to isolate true tyre degradation slope ($s/\text{lap}$) per compound. Structural fallback for Soft/Hard based on Medium.
- `speed_model.py`: Physics-based telemetry model estimating corner vs straightline speed degradation.
- `lap_stress.py`: Evaluates tyre mechanical workload ($Z_{stress}$) across cornering G-forces and track sectors.
- `race_validation.py`: 25% held-out stint validation within practice sessions and post-race telemetry validation (reporting MAE, RMSE, bias).
- `export_json.py` & `run_pipeline.py`: Compiles sensitivity grid over fuel priors ($0.03$–$0.08\text{ s/kg}$) and exports to `frontend/public/model_output.json`, `model_output_singapore.json`, and `model_output_monza.json`.
- `logistics_survival_model.py`: Synthesizes 10,000 commercial trips bridging F1 LME degradation to a Cox Proportional Hazards survival model. Exports `logistics_dual_model.json` to map physical heat to expected financial depreciation (Tyre Replacement + Cargo Risk).

---

### B. Interactive Frontend & Simulation (`Dr.Tyre-main/frontend/`)
Built with **Vite + Vanilla JS + Chart.js + CSS Glassmorphism + React sub-app (`research.html`)**.

#### 1. Core Shell & Router (`src/main.js`, `index.html`)
- Tab navigation between:
  - `page-track-select`: Circuit Cards (Singapore, Monza, Monaco, Silverstone) with SVG centerlines & weather conditions (Dry, Damp, Wet).
  - `page-car-setup`: Interactive SVG car schematic HUD (`setup/setup.js`). Configures aero downforce/balance, mechanical balance, brake bias, starting tyre, fuel load (70–110 kg), and energy deployment. Live FIA legality checker and tradeoff radar.
  - `page-simulation`: Live Race Control dashboard.
  - `page-competitors`: Competitor comparison matrix (`competitors/competitorsPage.js`).
  - `page-validation`: Model diagnostics and LME validation metrics.
  - `page-story`: 8-step methodology story walkthrough (`research/story.js`).
  - `page-logistics`: Logistics Lab commercial fleet translation (`logistics/logistics.js`).
  - `page-attendee`: Attendee pitch HUD (`attendee/attendeePanel.js`).
- `resolveActivePrior()`: Flattens the selected prior ($0.03$–$0.08$) from `sensitivity_grid` into `data.compounds`, `data.charts`, and `data.track_evolution`.

#### 2. Live Simulation & Race Control (`src/simulation/`)
- `simulation.js`: Live simulation orchestrator running at variable speeds ($1\times$ to $20\times$, modulated by `BASE_SIM_SPEED = 2.5` for ~1.9s/lap at 20x). Manages 20 cars, SC/VSC event engine, pit stops, and telemetry streaming.
- `track.js`: 2D SVG track animation. Renders track centerline, pit lane entry/exit/boxes, and animated car groups (`id="car-{id}"`) rotated along curve tangents.
- `trackDynamics.js`: High-fidelity physics model calculating car speed profiles, gear (1–8), throttle %, brake %, DRS zones, and cornering lateral G.
- `telemetry-ui.js`: Live HUD displaying car speed, gear, throttle/brake gauges, tyre temperature, thermal load, and lap time decomposition.
- `extra-charts.js` & `lap-chart.js`: Real-time stint degradation graphs and position history charts.
- `competitors.js`: Generates the 20-car grid with team liveries, AI driver traits, and AI pit stop logic.
- `scenarios.js`: Pre-built race scenarios (e.g. Lap 28 Undercut Window, Blistering Crisis, Safety Car Restart).

#### 3. AI Race Engineer & Prescription Engine (`src/simulation/strategy.js`)
- **Deterministic Optimal Pit Solver (`optimal_stop_lap`)**: Evaluates candidate stop laps using `simulate_stint_time` across the race distance, minimizing total time = current stint + pit lane cost + fresh tyre stint.
- **Grand Prix Cliff Baseline (`GP_CLIFF_THRESHOLDS`)**:
  - `SOFT`: 18 laps
  - `MEDIUM`: 30 laps
  - `HARD`: 48 laps
  - Raw polynomial vertex artifacts from short FP2 practice runs (< 15 laps) are replaced with realistic Grand Prix tyre physics via `getCompoundCliffLap(compound)`.
- **Compound Viability (`isCompoundViableForRemainingLaps`)**: Ensures 1-stop strategies (e.g. Medium $\rightarrow$ Hard) are recognized as viable to the chequered flag.
- **Stability Damping Filter (`trackedOptimalLap`)**: Prevents the optimal pit lap from fluctuating by 10–15 laps. Clamps frame-to-frame shifts to $\le \pm 1$ lap, maintaining a rock-solid target (e.g. Lap 27–28).
- **Thermal Macro Projection Dampening**: Damps instantaneous cornering temperature spikes towards compound operating windows during 30-lap future projections.
- **Tactical Rejoin Windowing**: Individual competitor dirty-air collision penalties at pit exit are evaluated only in the immediate tactical window ($\le 3$ laps ahead), preserving a smooth convex curve for the macro race horizon.
- **Prescription States & Explicit Target Tyre Display**:
  - **Early Stint**: `STAY OUT` (*"Continue on MEDIUM for X laps (Target: Lap 28 → HARD)"*).
  - **Approaching Stop**: `PIT IN 2 LAPS → HARD`, `PIT IN 1 LAP → HARD`.
  - **Stop Window Reached**: `PIT NOW → HARD` (*"Pit this lap and switch to HARD"*).
  - **Optimal Pit Metric (`DOM.rxOptPit`)**: Displays `LAP 28 (HARD)` before pitting, and cleanly shows `RACE FINISH` once the mandatory pit stop is fulfilled.
  - **Stint 2 / Race Finish (`pitStops >= 1`)**: Instructs the driver to `STAY OUT to race finish (Stint 2)`.

#### 4. Real-World Logistics Lab (`src/logistics/logistics.js`)
- Translates F1 tyre wear LME deconvolution into heavy commercial freight on the Jaipur $\rightarrow$ Delhi corridor (NH48, 280 km).
- **Dual-Model Architecture (LME + Cox Proportional Hazards)**:
  - Ingests `logistics_dual_model.json`.
  - Zero-latency 60fps bilinear interpolation across Payload (10–40t), Tarmac Temperature (20–60°C), and Rubber Grade (Budget, Standard, Premium).
  - Dual-Y-Axis Chart: Physical Tread Heat / Wear vs Expected Financial Depreciation (Tyre Replacement + Cargo Risk).
- **Fleet Scaling Projector**: Calculates annual blowout incidents, ₹ depreciation, and lives at risk for enterprise fleet sizes (10 to 5,000 trucks).

---

## 4. Design Aesthetics & Visual Standards
- **High-Contrast Theme:** Light theme with bold black `#000000` text, distinct 1.5px–2px solid black borders, and `0 4px 0 #000` neo-brutalist / glassmorphism card elevation.
- **Typography:** JetBrains Mono for telemetry, metrics, and lap times; clean modern sans-serif for UI labels and titles.
- **Chart.js Styling:** Black axis borders (`#000000`), tick colors, and labels with subtle grid lines (`rgba(0, 0, 0, 0.06)`).

---

## 5. Quick Execution & Build Commands
- **Run Pipeline:**
  ```powershell
  cd Dr.Tyre-main/pipeline
  python run_pipeline.py
  ```
- **Start Frontend Dev Server:**
  ```powershell
  cd Dr.Tyre-main/frontend
  npm run dev
  # Accessible at http://localhost:5173/
  ```
- **Build Frontend Bundle:**
  ```powershell
  cd Dr.Tyre-main/frontend
  npm run build
  ```

---

## 6. Important Operational Rules for AI Agents
1. **Never open browser subagents unless explicitly requested by the user.** The user has repeatedly asked for speed and headless validation. Use Node test scripts and `npm run build` for verification.
2. **Preserve High-Contrast Text:** All dashboard text must remain easily readable in black `#000000` / `#000`. Never revert cards to low-contrast white-on-white text.
3. **Respect Circuit Geometry:** SVG track progress coordinates must always be guarded against `NaN` or uninitialized paths.
4. **Preserve Stability Filter:** When modifying strategy or pit logic, always maintain the stability damping filter on `trackedOptimalLap` to prevent the optimal pit lap from oscillating.
