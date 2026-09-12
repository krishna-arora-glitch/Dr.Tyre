"""
run_pipeline.py — Pipeline Orchestrator

Runs the full tyre degradation isolation pipeline end-to-end:
  fetch → fuel correction → track evolution → traffic filter → 
  lap stress → degradation fitting → race validation → JSON export
"""

import os
import sys
import time

# Add pipeline dir to path
sys.path.insert(0, os.path.dirname(__file__))

from fetch_data import fetch_practice_data, fetch_race_data
from fuel_model import estimate_practice_fuel, estimate_race_fuel, apply_fuel_correction, get_fuel_params, fit_fuel_effect
from traffic_filter import detect_traffic_anomaly, detect_telemetry_traffic, filter_traffic, get_traffic_stats
from track_evolution import estimate_track_evolution, apply_track_evolution_correction, get_track_evo_params
from degradation_model import fit_degradation_curves
from race_validation import validate_held_out_stints
from export_json import build_observed_vs_ghost_baseline_chart, export_model_output, compute_pit_strategy
from export_telemetry import get_telemetry_dict
from speed_model import SpeedModel
from lap_stress import LapStressModel

import argparse

def run(track_id='singapore'):
    start = time.time()
    
    print("=" * 60)
    print("  TYRE DEGRADATION ISOLATION PIPELINE")
    print(f"  Track: {track_id.upper()}")
    print("=" * 60)
    
    # ── Step 1: Fetch Data ─────────────────────────────────────────
    print("\n- Step 1/7: Fetching data...")
    from fetch_data import generate_synthetic_practice, generate_synthetic_race, get_track_config
    
    config = get_track_config(track_id)
    practice_raw, practice_tel = fetch_practice_data(track_id)
    race_raw, race_tel = fetch_race_data(track_id)
    
    print("\n- Step 2/7: Initial fuel correction (default)...")
    practice = estimate_practice_fuel(practice_raw.copy())
    practice = apply_fuel_correction(practice)
    
    # We still need a preliminary clean data set to fit fuel effectively
    print("\n- Step 3/7: Quick preliminary traffic pass for Fuel Fitting...")
    prelim_practice = detect_traffic_anomaly(practice)
    prelim_clean = filter_traffic(prelim_practice, exclude=True, use_telemetry=False)
    
    fuel_fit_result = fit_fuel_effect(prelim_clean)
    print(f"  Fuel effect ({fuel_fit_result['source']}): {fuel_fit_result['value']} s/kg")
    
    fuel_params = get_fuel_params()
    fuel_params['fit_result'] = fuel_fit_result
    
    print("\n- Step 4-6: Running Sensitivity Grid...")
    priors = ["0.03", "0.04", "0.05", "0.06", "0.07", "0.08"]
    sensitivity_grid = {}
    
    for prior_str in priors:
        prior_val = float(prior_str)
        print(f"\n  [Prior = {prior_str}] Pipeline Execution...")
        
        # Fuel
        practice_prior = apply_fuel_correction(practice, fuel_effect=prior_val)
        
        # Track Evolution
        # Using old-method clean data to fit track evo safely
        prelim_practice_prior = apply_fuel_correction(prelim_practice, fuel_effect=prior_val)
        prelim_clean_prior = filter_traffic(prelim_practice_prior, exclude=True, use_telemetry=False)
        slope, intercept, lap_stats = estimate_track_evolution(prelim_clean_prior)
        
        # Apply track evo to ALL laps
        corrected_practice = apply_track_evolution_correction(practice_prior, slope, intercept)
        max_time = prelim_clean_prior['SessionTime_s'].max()
        track_evo_params = get_track_evo_params(slope, intercept, max_time)
        
        # ── TELEMETRY PIPELINE ──
        # 1. Build Speed Model
        speed_model = SpeedModel()
        clean_approx = filter_traffic(detect_traffic_anomaly(corrected_practice), exclude=True, use_telemetry=False)
        speed_model.fit_expected_profile(practice_tel, clean_approx)
        telemetry_metadata = speed_model.get_metadata()
        
        # 2. Add speed residuals
        practice_tel = speed_model.calculate_residuals(practice_tel, corrected_practice)
        
        # 3. Detect telemetry traffic
        corrected_practice = detect_telemetry_traffic(corrected_practice, practice_tel, speed_model)
        traffic_stats = get_traffic_stats(corrected_practice, use_telemetry=True)
        
        # 4. Compute Lap Stress
        lap_stress_model = LapStressModel()
        corrected_practice = lap_stress_model.compute_workloads(corrected_practice, practice_tel)
        corrected_practice = lap_stress_model.normalize_and_compute_stress(corrected_practice)
        stress_metadata = lap_stress_model.get_metadata()
        
        # 5. Get filtering cuts
        clean_old = filter_traffic(detect_traffic_anomaly(corrected_practice), exclude=True, use_telemetry=False)
        clean_telemetry = filter_traffic(corrected_practice, exclude=True, use_telemetry=True)
        
        # 6. Fit Models
        deg_models = {
            'baseline': fit_degradation_curves(clean_old, use_stress=False),
            'telemetry_traffic': fit_degradation_curves(clean_telemetry, use_stress=False),
            'telemetry_stress': fit_degradation_curves(clean_telemetry, use_stress=True)
        }
        
        # 7. Held-out Stint Validation
        validation = validate_held_out_stints(practice_prior, practice_tel)
        
        # 8. Ghost baseline chart data (using telemetry model)
        observed_vs_ghost = build_observed_vs_ghost_baseline_chart(practice_raw, corrected_practice)
        
        sensitivity_grid[prior_str] = {
            'track_evo_params': track_evo_params,
            'deg_models': deg_models,
            'validation_result': validation,
            'observed_vs_ghost_baseline': observed_vs_ghost,
            'telemetry_metadata': telemetry_metadata,
            'stress_metadata': stress_metadata,
            'traffic_stats': traffic_stats
        }
        
    default_models = sensitivity_grid["0.05"]["deg_models"]["telemetry_stress"]
    pit_strategy = compute_pit_strategy(default_models, race_laps=config['RACE_LAPS'])
    
    race_info = {
        'name': config['NAME'],
        'track': config['VENUE'],
        'laps': config['RACE_LAPS'],
        'trackId': track_id,
        'year': 2024,
        'is_synthetic': True,
    }
    
    output_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public', f'model_output_{track_id.lower()}.json')
    output_path = os.path.normpath(output_path)
    
    default_traffic = sensitivity_grid["0.05"]["traffic_stats"]
    
    telemetry_samples = get_telemetry_dict(practice_tel, target_samples=150)
    
    export_model_output(
        race_info=race_info,
        sensitivity_grid=sensitivity_grid,
        fuel_params=fuel_params,
        traffic_stats=default_traffic,
        pit_strategy=pit_strategy,
        telemetry_samples=telemetry_samples,
        output_path=output_path,
    )
    
    elapsed = time.time() - start
    print("\n" + "=" * 60)
    print(f"  Pipeline complete in {elapsed:.1f}s")
    print(f"  Output: {output_path}")
    print("=" * 60)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Tyre Degradation Isolation Pipeline")
    parser.add_argument('--track_id', type=str, help='Track ID to simulate. If omitted, runs all tracks.')
    args = parser.parse_args()
    
    if args.track_id:
        run(args.track_id)
    else:
        for track in ['singapore', 'monza', 'monaco']:
            run(track)
