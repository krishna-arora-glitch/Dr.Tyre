"""
run_pipeline.py — Pipeline Orchestrator

Runs the full tyre degradation isolation pipeline end-to-end:
  fetch → fuel correction → traffic filter → track evolution → 
  degradation fitting → race validation → JSON export
"""

import os
import sys
import time

# Add pipeline dir to path
sys.path.insert(0, os.path.dirname(__file__))

from fetch_data import fetch_practice_data, fetch_race_data
from fuel_model import estimate_practice_fuel, estimate_race_fuel, apply_fuel_correction, get_fuel_params, fit_fuel_effect
from traffic_filter import detect_traffic_anomaly, filter_traffic, get_traffic_stats
from track_evolution import estimate_track_evolution, apply_track_evolution_correction, get_track_evo_params
from degradation_model import fit_degradation_curves
from race_validation import validate_held_out_stints
from export_json import build_observed_vs_ghost_baseline_chart, export_model_output, compute_pit_strategy


def run():
    start = time.time()
    
    print("=" * 60)
    print("  TYRE DEGRADATION ISOLATION PIPELINE")
    print("  2024 Singapore GP — Marina Bay Street Circuit")
    print("=" * 60)
    
    # ── Step 1: Fetch Data ─────────────────────────────────────────
    print("\n- Step 1/7: Fetching data...")
    practice_raw = fetch_practice_data()
    race_raw = fetch_race_data()
    
    print("\n- Step 2/7: Initial fuel correction (default)...")
    practice = estimate_practice_fuel(practice_raw.copy())
    practice = apply_fuel_correction(practice)
    
    # ── Step 3: Traffic Filtering ──────────────────────────────────
    print("\n- Step 3/7: Detecting traffic...")
    practice = detect_traffic_anomaly(practice)
    traffic_stats = get_traffic_stats(practice)
    clean_practice = filter_traffic(practice, exclude=True)
    
    # ── Step 3.5: Fuel Effect Fitting ──────────────────────────────
    print("\n- Step 3.5/7: Fitting fuel effect from clean data...")
    fuel_fit_result = fit_fuel_effect(clean_practice)
    print(f"  Fuel effect ({fuel_fit_result['source']}): {fuel_fit_result['value']} s/kg")
    if fuel_fit_result['source'] == 'default':
        print(f"  Fallback reason: {fuel_fit_result.get('reason', 'unknown')}")
        
    # Re-apply fuel correction using fitted (or validated default) value
    clean_practice = apply_fuel_correction(clean_practice, fuel_effect=fuel_fit_result['value'])
    
    race = estimate_race_fuel(race_raw.copy())
    race = apply_fuel_correction(race, fuel_effect=fuel_fit_result['value'])
    
    fuel_params = get_fuel_params()
    fuel_params['fit_result'] = fuel_fit_result
    
    print(f"  Practice mean correction: {clean_practice['fuel_correction_s'].mean():.3f}s")
    

    
    # ── Step 4: Track Evolution ────────────────────────────────────
    print("\n- Step 4/7: Modeling track evolution...")
    slope, intercept, lap_stats = estimate_track_evolution(clean_practice)
    corrected_practice = apply_track_evolution_correction(clean_practice, slope, intercept)
    
    max_lap = clean_practice['LapNumber'].max()
    track_evo_params = get_track_evo_params(slope, intercept, max_lap)
    
    # ── Step 5: Degradation Curve Fitting ──────────────────────────
    print("\n- Step 5/7: Fitting degradation curves...")
    deg_models = fit_degradation_curves(corrected_practice)
    
    if not deg_models:
        print("[ERROR] No degradation models fitted!")
        return
    
    # ── Step 6: Held-Out Stint Validation ──────────────────────────
    print("\n- Step 6/7: Validating via held-out practice stints...")
    validation = validate_held_out_stints(corrected_practice)
    
    # ── Step 7: Export JSON ────────────────────────────────────────
    print("\n- Step 7/7: Exporting to JSON...")
    
    # Build chart data
    observed_vs_ghost = build_observed_vs_ghost_baseline_chart(practice_raw, corrected_practice)
    
    # Pit strategy
    pit_strategy = compute_pit_strategy(deg_models, race_laps=62)
    
    # Race info
    race_info = {
        'name': '2024 Singapore Grand Prix',
        'track': 'Marina Bay Street Circuit',
        'laps': 62,
        'year': 2024,
        'is_synthetic': bool(practice_raw.get('is_synthetic', pd.Series([True])).iloc[0]) if 'is_synthetic' in practice_raw.columns else True,
    }
    
    # Output path
    output_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public', 'model_output.json')
    output_path = os.path.normpath(output_path)
    
    export_model_output(
        race_info=race_info,
        deg_models=deg_models,
        fuel_params=fuel_params,
        track_evo_params=track_evo_params,
        traffic_stats=traffic_stats,
        validation_result=validation,
        observed_vs_ghost_baseline=observed_vs_ghost,
        pit_strategy=pit_strategy,
        output_path=output_path,
    )
    
    elapsed = time.time() - start
    
    print("\n" + "=" * 60)
    print(f"  Pipeline complete in {elapsed:.1f}s")
    print(f"  Output: {output_path}")
    print(f"  Compounds modeled: {list(deg_models.keys())}")
    if validation:
        print(f"  Validation MAE: {validation['metrics']['mae']:.3f}s")
        print(f"  Validation RMSE: {validation['metrics']['rmse']:.3f}s")
    print("=" * 60)


if __name__ == '__main__':
    # Need pandas in scope for race_info check
    import pandas as pd
    run()
