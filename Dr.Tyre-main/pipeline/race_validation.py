"""
race_validation.py — Held-Out Stint Validation

Evaluates model accuracy using a strict stint-level train/test holdout
within the practice session, without train/test data leakage.
"""

import numpy as np
import pandas as pd
from degradation_model import fit_degradation_curves
from speed_model import SpeedModel
from traffic_filter import detect_telemetry_traffic, filter_traffic
from lap_stress import LapStressModel
from track_evolution import estimate_track_evolution, apply_track_evolution_correction

def evaluate_models(train_models_dict, test_df_processed, time_col='LapTime_corrected'):
    results = {}
    
    for model_name, models in train_models_dict.items():
        all_predicted = []
        all_actual = []
        
        for compound in models:
            model = models[compound]
            if not model.get('fit_available', False):
                continue
                
            test_subset = test_df_processed[test_df_processed['Compound'] == compound]
            for _, lap in test_subset.iterrows():
                tyre_age = lap['TyreLife']
                actual = lap[time_col]
                
                # Predict: base pace + degradation (stress is 0 for prediction as it's normalized to median 0)
                deg_delta = model['deg_linear'] * tyre_age + model['deg_quadratic'] * tyre_age ** 2
                predicted = model['base_pace'] + deg_delta
                
                all_predicted.append(round(predicted, 3))
                all_actual.append(round(actual, 3))
                
        if not all_predicted:
            results[model_name] = None
            continue
            
        predicted = np.array(all_predicted)
        actual = np.array(all_actual)
        errors = predicted - actual
        abs_errors = np.abs(errors)
        
        mae = round(float(np.mean(abs_errors)), 3)
        rmse = round(float(np.sqrt(np.mean(errors ** 2))), 3)
        mean_bias = round(float(np.mean(errors)), 3)
        
        results[model_name] = {
            'mae': mae,
            'rmse': rmse,
            'mean_bias': mean_bias,
        }
        
    return results

def validate_held_out_stints(practice_df, telemetry_dict, test_size_ratio=0.25):
    """
    Perform a strict held-out stint validation without data leakage.
    """
    stints = practice_df[['Driver', 'Stint']].drop_duplicates()
    n_stints = len(stints)
    
    if n_stints < 4:
        print("[WARN] Not enough stints for reliable holdout validation")
        return None
        
    np.random.seed(42)
    test_idx = np.random.choice(n_stints, size=max(1, int(n_stints * test_size_ratio)), replace=False)
    test_stints = stints.iloc[test_idx]
    
    keys = ['Driver', 'Stint']
    test_df = pd.merge(practice_df, test_stints, on=keys, how='inner')
    
    train_df = pd.merge(practice_df, test_stints, on=keys, how='outer', indicator=True)
    train_df = train_df[train_df['_merge'] == 'left_only'].drop(columns=['_merge'])
    
    print(f"\n[Validation] Held-out {len(test_df)} laps ({len(test_stints)} stints) for test set")
    
    # --- TRAINING PHASE ---
    # 0. Track Evolution (Fit on train, apply to train and test)
    # We need a quick clean pass to fit track evo safely
    clean_approx_train = filter_traffic(train_df, exclude=True, use_telemetry=False)
    slope, intercept, _ = estimate_track_evolution(clean_approx_train)
    
    train_df = apply_track_evolution_correction(train_df, slope, intercept)
    test_df = apply_track_evolution_correction(test_df, slope, intercept)
    
    # 1. Build Speed Model on Train
    speed_model = SpeedModel()
    # Re-filter train_df after track evo for a better speed model
    clean_approx_train = filter_traffic(train_df, exclude=True, use_telemetry=False)
    speed_model.fit_expected_profile(telemetry_dict, clean_approx_train)
    
    # 2. Add speed residuals
    telemetry_dict = speed_model.calculate_residuals(telemetry_dict, train_df)
    
    # 3. Detect telemetry traffic on train
    train_df = detect_telemetry_traffic(train_df, telemetry_dict, speed_model)
    
    # 4. Compute Lap Stress on train
    lap_stress_model = LapStressModel()
    train_df = lap_stress_model.compute_workloads(train_df, telemetry_dict)
    train_df = lap_stress_model.normalize_and_compute_stress(train_df)
    
    # Filter training sets
    train_clean_old = filter_traffic(train_df, exclude=True, use_telemetry=False)
    train_clean_telemetry = filter_traffic(train_df, exclude=True, use_telemetry=True)
    
    # Train 3 Models
    train_models_dict = {
        'old_model': fit_degradation_curves(train_clean_old, use_stress=False),
        'speed_model': fit_degradation_curves(train_clean_telemetry, use_stress=False),
        'stress_model': fit_degradation_curves(train_clean_telemetry, use_stress=True)
    }
    
    # --- TEST PHASE ---
    # Apply models to Test Set
    telemetry_dict = speed_model.calculate_residuals(telemetry_dict, test_df)
    test_df = lap_stress_model.compute_workloads(test_df, telemetry_dict)
    test_df = lap_stress_model.normalize_and_compute_stress(test_df)
    
    test_df = detect_telemetry_traffic(test_df, telemetry_dict, speed_model)
    test_clean = filter_traffic(test_df, exclude=True, use_telemetry=True)
    
    results = evaluate_models(train_models_dict, test_clean)
    
    print("\n[Validation Results]")
    for m, r in results.items():
        if r:
            print(f"  {m} MAE: {r['mae']:.3f}s, RMSE: {r['rmse']:.3f}s")
            
    return {
        'metrics': {
            'mae': results['old_model']['mae'] if results.get('old_model') else 0, # fallback to old for legacy UI
            'old_model': results.get('old_model'),
            'speed_model': results.get('speed_model'),
            'stress_model': results.get('stress_model'),
            'n_laps_validated': len(test_clean),
            'n_stints_validated': len(test_stints),
            'method': 'Strict held-out stint validation (no leakage)'
        }
    }
