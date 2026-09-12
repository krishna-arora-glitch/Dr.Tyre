---
name: trackshift_project
description: Permanent context, problem statement, TrackShift 2026 principles, and codebase map for Dr.Tyre
---

# TrackShift 2026 Project Knowledge

## Challenge & Problem Statement
- **Theme:** AI Motorsport Intelligence
- **Overview:** Isolating true tyre wear rates from confounding practice variables like fuel weight, traffic, and track evolution.
- **The Goal:** Create a predictive model that strips out external noise from practice sessions to generate clean tyre performance degradation curves. Includes post-race validation tools to compare predicted wear against actual race-day pace.

## TrackShift 2026 Core Principles
1. **Constraint is the Design Brief:** Great engineering comes from solving complex problems within real-world constraints, encouraging participants to build practical and scalable solutions.
2. **Real-World Impact:** Every solution should demonstrate measurable impact, technical feasibility, and the potential to create meaningful outcomes beyond the challenge.
3. **Motorsport as Inspiration:** Participants are expected to apply proven motorsport engineering principles such as pit wall intelligence, precision logistics, energy recovery, and supply chain traceability to solve real-world challenges.

## Codebase Architecture Reference
- Pipeline location: `Dr.Tyre-main/pipeline/` (`fetch_data.py`, `fuel_model.py`, `traffic_filter.py`, `track_evolution.py`, `degradation_model.py`, `race_validation.py`, `export_json.py`, `run_pipeline.py`)
- Frontend location: `Dr.Tyre-main/frontend/` (`index.html`, `research.html`, `src/simulation/`, `src/setup/`, `src/competitors/`, `src/research/`, `src/logistics/`)
- Key Features:
  - F1 tyre degradation isolation via Linear Mixed Effects (LME).
  - Counterfactual "Ghost Baseline" with reactive fuel-prior sensitivity slider ($0.03$–$0.08\text{ s/kg}$).
  - Live 2D SVG track race simulator with 20 cars, pit-lane routing, and AI Race Engineer.
  - Car setup HUD with aero/mechanical/fuel sliders and FIA legality checks.
  - Competitor undercut viability calculator.
  - Logistics Lab transferring F1 tyre thermal degradation to heavy transport blowout prevention on the Jaipur → Delhi corridor (280 km).
