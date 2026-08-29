"""
race_validation.py — Held-Out Stint Validation

Evaluates model accuracy using a strict stint-level train/test holdout
within the practice session. Replaces the abandoned practice->race prediction.
"""

import numpy as np
import pandas as pd
from degradation_model import fit_degradation_curves

def validate_held_out_stints(practice_df, test_size_ratio=0.25):
    """
    Perform a held-out stint validation.
    
    1. Identify all unique stints in the practice session.
    2. Randomly select 25% of stints for validation (test set).
    3. Train the model on the remaining 75% of stints.
    4. Evaluate the predictions on the held-out test set.
    """
    stints = practice_df[['Driver', 'Stint']].drop_duplicates()
    n_stints = len(stints)
    
    if n_stints < 4:
        print("[WARN] Not enough stints for reliable holdout validation")
        return None
        
    # Set seed for deterministic holdout in demo
    np.random.seed(42)
    test_idx = np.random.choice(n_stints, size=max(1, int(n_stints * test_size_ratio)), replace=False)
    
    test_stints = stints.iloc[test_idx]
    
    # Create train and test sets
    keys = ['Driver', 'Stint']
    test_df = pd.merge(practice_df, test_stints, on=keys, how='inner')
    
    # Train set is everything NOT in test set
    train_df = pd.merge(practice_df, test_stints, on=keys, how='outer', indicator=True)
    train_df = train_df[train_df['_merge'] == 'left_only'].drop(columns=['_merge'])
    
    print(f"\n[Validation] Held-out {len(test_df)} laps ({len(test_stints)} stints) for validation")
    
    # Fit models on training data only
    train_models = fit_degradation_curves(train_df)
    
    all_predicted = []
    all_actual = []
    
    for compound in train_models:
        model = train_models[compound]
        if not model['fit_available']:
            continue
            
        test_subset = test_df[test_df['Compound'] == compound]
        for _, lap in test_subset.iterrows():
            tyre_age = lap['TyreLife']
            actual = lap['LapTime_corrected'] # Predict against corrected baseline
            
            # Predict: base pace + degradation
            deg_delta = model['deg_linear'] * tyre_age + model['deg_quadratic'] * tyre_age ** 2
            predicted = model['base_pace'] + deg_delta
            
            all_predicted.append(round(predicted, 3))
            all_actual.append(round(actual, 3))
            
    if not all_predicted:
        return None
        
    predicted = np.array(all_predicted)
    actual = np.array(all_actual)
    errors = predicted - actual
    abs_errors = np.abs(errors)
    
    mae = round(float(np.mean(abs_errors)), 3)
    rmse = round(float(np.sqrt(np.mean(errors ** 2))), 3)
    mean_bias = round(float(np.mean(errors)), 3)
    
    result = {
        'metrics': {
            'mae': mae,
            'rmse': rmse,
            'mean_bias': mean_bias,
            'n_laps_validated': len(all_predicted),
            'n_stints_validated': len(test_stints),
            'method': 'Held-out stint validation (Practice only)'
        }
    }
    
    print(f"  Validation MAE:  {mae:.3f}s")
    print(f"  Validation RMSE: {rmse:.3f}s")
    print(f"  Mean bias: {mean_bias:+.3f}s")
    
    return result
