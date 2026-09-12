"""
run_validation.py — Sunday Oracle Validation Pipeline

Pulls Sunday race telemetry, isolates Stint 1 on MEDIUM compound, applies the 
same fuel and track evolution corrections as Friday, and calculates the actual 
Sunday Pace Loss by extracting and subtracting the Sunday Base Pace.
"""

import os
import sys
import json
import numpy as np
import pandas as pd

# Add pipeline dir to path
sys.path.insert(0, os.path.dirname(__file__))

from fetch_data import fetch_race_data
from fuel_model import estimate_race_fuel, apply_fuel_correction
from track_evolution import apply_track_evolution_correction
from traffic_filter import detect_traffic_anomaly, filter_traffic

FRONTEND_PUBLIC_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public'))

def run_validation():
    print("=" * 60)
    print("  SUNDAY ORACLE VALIDATION PIPELINE")
    print("=" * 60)

    # 1. Load Friday model output to get Track Evo slopes and Fuel Priors
    model_json_path = os.path.join(FRONTEND_PUBLIC_DIR, 'model_output.json')
    if not os.path.exists(model_json_path):
        print(f"[ERROR] Cannot find {model_json_path}. Run run_pipeline.py first.")
        return

    with open(model_json_path, 'r') as f:
        model_data = json.load(f)
        
    sensitivity_grid = model_data.get('sensitivity_grid', {})
    if not sensitivity_grid:
        print("[ERROR] No sensitivity_grid found in model_output.json")
        return

    # 2. Fetch Race Data
    print("\n- Fetching Sunday Race Data...")
    race_df = fetch_race_data()
    
    # 3. Filter for Stint 1 on MEDIUM
    # We want drivers who started on MEDIUM and did at least 10 laps
    stint1 = race_df[race_df['Stint'] == 1].copy()
    stint1 = stint1[stint1['Compound'] == 'MEDIUM']
    
    stint_lengths = stint1.groupby('Driver')['TyreLife'].max()
    valid_drivers = stint_lengths[stint_lengths >= 10].index
    stint1 = stint1[stint1['Driver'].isin(valid_drivers)]
    
    print(f"  Found {len(valid_drivers)} drivers for validation: {list(valid_drivers)}")

    if len(stint1) == 0:
        print("[ERROR] No valid Stint 1 MEDIUM data found.")
        return

    # 4. Filter out traffic (Laps > 105% of median)
    # detect_traffic_anomaly flags it
    stint1 = detect_traffic_anomaly(stint1, time_col='LapTime_s')
    clean_race = filter_traffic(stint1, exclude=True)
    
    # 5. Estimate Fuel Load
    clean_race = estimate_race_fuel(clean_race)
    
    validation_output = {
        'metadata': {
            'session': 'Race',
            'stint': 1,
            'compound': 'MEDIUM',
            'drivers': list(valid_drivers)
        },
        'validation_grid': {}
    }

    # 6. Process for each Fuel Prior
    for prior_str, prior_data in sensitivity_grid.items():
        prior_val = float(prior_str)
        print(f"\n- Validating Prior {prior_str} s/kg...")
        
        # Fuel Correction
        corrected = apply_fuel_correction(clean_race, fuel_effect=prior_val)
        
        # Track Evolution Correction
        evo_params = prior_data['track_evolution']
        slope = evo_params['slope_s_per_sec']
        intercept = 0  # intercept doesn't matter for normalization, but we can pass 0
        
        corrected = apply_track_evolution_correction(corrected, slope, intercept)

        # 7. Dynamic Base Pace Calibration
        # We fit a quadratic to the corrected lap times vs tyre age to find the intercept (age 0)
        # We do this for all drivers combined to find the average Sunday pace loss curve
        
        x = corrected['TyreLife'].values
        y = corrected['LapTime_corrected'].values
        
        # Fit quadratic: y = a*x^2 + b*x + c
        # c is the Base Pace
        coeffs = np.polyfit(x, y, 2)
        base_pace = coeffs[2]
        
        # Actual Pace Loss
        corrected['actual_pace_loss'] = corrected['LapTime_corrected'] - base_pace
        
        # Aggregate by Tyre Age to get the mean actual pace loss
        agg = corrected.groupby('TyreLife')['actual_pace_loss'].mean().reset_index()
        
        # Save to grid
        validation_output['validation_grid'][prior_str] = {
            'base_pace_s': round(base_pace, 3),
            'ages': agg['TyreLife'].tolist(),
            'actual_pace_loss': agg['actual_pace_loss'].round(3).tolist(),
            'sunday_linear_deg': round(coeffs[1], 4),
            'sunday_quad_deg': round(coeffs[0], 6)
        }
        
        print(f"  Sunday Base Pace: {base_pace:.3f}s")
        print(f"  Sunday Deg Slope: +{coeffs[1]:.4f}s/lap")

    # 8. Export Validation Output
    out_path = os.path.join(FRONTEND_PUBLIC_DIR, 'validation_output.json')
    with open(out_path, 'w') as f:
        json.dump(validation_output, f, indent=2)
        
    print(f"\n[OK] Validation output saved to {out_path}")

if __name__ == '__main__':
    run_validation()
