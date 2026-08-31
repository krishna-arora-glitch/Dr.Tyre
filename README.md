# Dr.Tyre — AI-Powered Tyre Strategy Intelligence

> **Team:** Shall We Develop | **Hackathon:** TrackShift

Dr.Tyre is an end-to-end AI motorsport intelligence platform that isolates true tyre degradation from raw telemetry and powers a real-time race strategy simulator.

---

## The Problem

Raw lap times **don't tell you what the tyre is doing.** Fuel burn makes the car faster each lap, track evolution shifts the baseline, and dirty air corrupts the signal. Teams need to strip away every confounding variable to see the tyre's true performance curve.

## Our Solution

Dr.Tyre uses a multi-stage data pipeline to decompose lap times into their hidden components, then feeds the isolated tyre degradation model into an interactive race simulation with an AI race engineer.

---

## Architecture

`
Dr.Tyre/
+-- pipeline/          # Python data science backend (FastF1 + regression)
|   +-- fetch_data.py          # Pulls telemetry via FastF1 API
|   +-- fuel_model.py          # Estimates & removes fuel effect
|   +-- track_evolution.py     # Models track rubbering-in
|   +-- traffic_filter.py      # Detects & removes dirty-air laps
|   +-- degradation_model.py   # Fits tyre degradation curves
|   +-- export_json.py         # Exports model_output.json for frontend
|   +-- run_pipeline.py        # Orchestrates the full pipeline
|   +-- requirements.txt
|
+-- frontend/          # Vite + Vanilla JS interactive dashboard
    +-- index.html             # Main application shell
    +-- src/
        +-- main.js            # App entry, tab navigation, data loading
        +-- style.css          # Core design system
        +-- race-control.css   # Race simulation UI styles
        +-- simulation/        # Race engine, track rendering, strategy AI
        +-- research/          # Research story walkthrough
        +-- setup/             # Car & track setup panels
        +-- competitors/       # Competitor comparison view
        +-- ghostpace/         # Ghost baseline charts
        +-- analysis/          # Validation & analysis panels
`

---

## Features

### Research Story
An 8-step interactive walkthrough showing how we isolate tyre degradation:
1. Raw lap times (the problem)
2. Fuel masking removal
3. Track evolution correction
4. Traffic filtering
5. Ghost baseline construction
6. True tyre-induced pace loss
7. Model confidence metrics
8. Strategy simulation preview

### Race Control Simulator
- **2D SVG Track** with neon-styled rendering and animated car positions
- **AI Race Engineer** with real-time pit recommendations and confidence levels
- **Pit Decision Panel** for manual strategy overrides
- **Lap History** tracking position, tyre degradation, and lap times
- **Race Events Feed** with professional F1-style messages
- **Live Telemetry** showing fuel, tyre age, pace delta, and gap data

### Strategy Charts
- Tyre strategy comparison across all cars
- Lap time trends with degradation overlays
- Position change tracking
- Pit stop history analysis
- Weather and track temperature data

### Competitor Comparison
- Side-by-side analysis of all grid competitors
- Tyre compound performance comparison

---

## How to Run

### 1. Run the Python Pipeline
Downloads 2024 Singapore GP data, applies corrections, and exports `model_output.json`.

`ash
cd pipeline
pip install -r requirements.txt
python run_pipeline.py
`

> FastF1 downloads ~2GB of telemetry on the first run (cached in `pipeline/cache/`).

### 2. Run the Frontend Dashboard

`ash
cd frontend
npm install
npm run dev
`

Open `http://localhost:5173` in your browser.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Data Pipeline | Python, FastF1, NumPy, SciPy |
| Frontend | Vanilla JS, Vite, Chart.js |
| Visualization | SVG, Canvas, CSS Animations |
| Strategy Engine | Custom deterministic simulation |

---

## Known Limitations

- **Fuel loads are estimated:** Real F1 fuel data is not public. We assume 55kg for practice, 110kg for race, with 1.77kg/lap burn rate.
- **Traffic is inferred:** A 3-lap rolling median anomaly detector flags dirty-air laps (>1.5 sigma slower than rolling median).
- **Track evolution is approximated:** Modeled as a logarithmic improvement over session time.

---

## Team

**Shall We Develop** — Built for the TrackShift Hackathon 2024
