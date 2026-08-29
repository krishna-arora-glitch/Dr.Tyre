"""
fuel_model.py — Fuel Load Correction Model

Estimates per-lap fuel load and corrects lap times to a reference fuel level.
Fuel sensitivity at Singapore: ~0.035 s/kg (high for street circuit).
"""

import numpy as np
import pandas as pd


# ── Fuel Parameters (2024 Singapore GP) ───────────────────────────
FUEL_SENSITIVITY = 0.035  # seconds per kg
MAX_RACE_FUEL_KG = 110.0
RACE_LAPS = 62
RACE_BURN_RATE = MAX_RACE_FUEL_KG / RACE_LAPS  # ~1.77 kg/lap

# For FP2: cars typically run lighter
FP2_STARTING_FUEL_ESTIMATE = {
    'short_run': 30.0,   # qualifying sim
    'long_run': 55.0,    # race sim / long run
}
FP2_BURN_RATE = 1.6  # slightly lower in practice (less aggressive)

REFERENCE_FUEL_KG = 55.0  # normalize all laps to this reference

MIN_FUEL_FIT_LAPS = 20
MIN_FUEL_EFFECT = 0.010
MAX_FUEL_EFFECT = 0.080
MAX_CONDITION_NUMBER = 1e4


def estimate_practice_fuel(df):
    """
    Estimate fuel load for each practice lap.
    
    Heuristic: Stints < 5 laps are treated as short runs (lower starting fuel).
    Stints >= 5 laps are long runs.
    """
    df = df.copy()
    
    # Compute stint lengths
    stint_lengths = df.groupby(['Driver', 'Stint'])['TyreLife'].max()
    stint_length_map = stint_lengths.to_dict()
    
    fuel_loads = []
    for _, row in df.iterrows():
        stint_key = (row['Driver'], row['Stint'])
        stint_len = stint_length_map.get(stint_key, 5)
        
        if stint_len < 5:
            starting_fuel = FP2_STARTING_FUEL_ESTIMATE['short_run']
        else:
            starting_fuel = FP2_STARTING_FUEL_ESTIMATE['long_run']
        
        # Fuel decreases linearly through the stint
        laps_into_stint = row['TyreLife']
        fuel_kg = max(5.0, starting_fuel - (laps_into_stint * FP2_BURN_RATE))
        fuel_loads.append(round(fuel_kg, 2))
    
    df['fuel_load_kg'] = fuel_loads
    return df


def estimate_race_fuel(df):
    """
    Estimate fuel load for each race lap.
    Race starts at ~110 kg and burns linearly.
    """
    df = df.copy()
    df['fuel_load_kg'] = (MAX_RACE_FUEL_KG - df['LapNumber'] * RACE_BURN_RATE).clip(lower=5.0).round(2)
    return df


def fit_fuel_effect(df):
    """
    Jointly fit the fuel effect (k) across multiple stints to separate
    tyre degradation from fuel burn.
    
    Returns a dict with the fitted or default fuel coefficient and diagnostics.
    """
    if len(df) < MIN_FUEL_FIT_LAPS:
        return {
            'source': 'default',
            'value': FUEL_SENSITIVITY,
            'reason': f'insufficient usable laps ({len(df)} < {MIN_FUEL_FIT_LAPS})',
            'diagnostics': {
                'usable_laps': len(df),
                'stints': 0,
                'rank': 0,
                'condition_number': 0
            }
        }
        
    compounds = df['Compound'].unique()
    
    # Check stint variety (need pit stops to break collinearity)
    n_stints = df['Stint'].nunique() if 'Stint' in df.columns else 1
    
    # Build design matrix X for: LapTime = sum(is_comp * base_comp) + sum(is_comp * TyreLife * deg_comp) + k * fuel_load
    X_cols = []
    for comp in compounds:
        df[f'is_{comp}'] = (df['Compound'] == comp).astype(float)
        df[f'tyrelife_{comp}'] = df[f'is_{comp}'] * df['TyreLife']
        X_cols.extend([f'is_{comp}', f'tyrelife_{comp}'])
        
    X_cols.append('fuel_load_kg')
    
    X = df[X_cols].values
    y = df['LapTime_s'].values
    
    # Validation 1: Rank check
    rank = np.linalg.matrix_rank(X)
    
    # Scale columns roughly to avoid artificial ill-conditioning
    X_scaled = X / np.max(np.abs(X), axis=0)
    cond = np.linalg.cond(X_scaled)

    if rank < X.shape[1]:
        return {
            'source': 'default',
            'value': FUEL_SENSITIVITY,
            'reason': 'design matrix is rank-deficient (perfect collinearity)',
            'diagnostics': {
                'usable_laps': len(df),
                'stints': n_stints,
                'rank': int(rank),
                'condition_number': "Infinity"
            }
        }
        
    # Validation 2: Condition number check
    # Scale columns roughly to avoid artificial ill-conditioning
    X_scaled = X / np.max(np.abs(X), axis=0)
    cond = np.linalg.cond(X_scaled)
    
    if cond > MAX_CONDITION_NUMBER:
        return {
            'source': 'default',
            'value': FUEL_SENSITIVITY,
            'reason': f'poor conditioning (cond={cond:.1f}), insufficient independent stint variation',
            'diagnostics': {
                'usable_laps': len(df),
                'stints': n_stints,
                'rank': int(rank),
                'condition_number': round(float(cond), 1)
            }
        }
        
    # Fit OLS
    try:
        from sklearn.linear_model import LinearRegression
        model = LinearRegression(fit_intercept=False)
        model.fit(X, y)
        k_fit = float(model.coef_[-1])  # fuel_load_kg is the last column
        
        # Validation 3: Physical plausibility
        if not (MIN_FUEL_EFFECT <= k_fit <= MAX_FUEL_EFFECT):
            return {
                'source': 'default',
                'value': FUEL_SENSITIVITY,
                'reason': f'fitted value {k_fit:.4f} outside physical bounds [{MIN_FUEL_EFFECT}, {MAX_FUEL_EFFECT}]',
                'diagnostics': {
                    'usable_laps': len(df),
                    'stints': n_stints,
                    'rank': int(rank),
                    'condition_number': round(float(cond), 1)
                }
            }
            
        return {
            'source': 'fitted',
            'value': round(k_fit, 4),
            'diagnostics': {
                'usable_laps': len(df),
                'stints': n_stints,
                'rank': int(rank),
                'condition_number': round(float(cond), 1)
            }
        }
        
    except Exception as e:
        return {
            'source': 'default',
            'value': FUEL_SENSITIVITY,
            'reason': f'fitting error: {str(e)}',
            'diagnostics': {
                'usable_laps': len(df),
                'stints': n_stints,
                'rank': 0,
                'condition_number': 0
            }
        }


def apply_fuel_correction(df, fuel_effect=None, reference_fuel=REFERENCE_FUEL_KG):
    """
    Correct lap times by removing the fuel weight effect.
    
    A heavier car is slower → positive fuel effect.
    Correction: subtract the delta between actual fuel and reference fuel,
    scaled by sensitivity.
    
    corrected_time = raw_time - (fuel_load - reference) × sensitivity
    
    This normalizes all laps as if driven at the reference fuel load.
    """
    df = df.copy()
    
    if 'fuel_load_kg' not in df.columns:
        raise ValueError("Run estimate_practice_fuel or estimate_race_fuel first")
    
    # Use provided fuel_effect or default
    k = fuel_effect if fuel_effect is not None else FUEL_SENSITIVITY
    
    # Fuel delta: positive means heavier than reference (slower)
    df['fuel_delta_kg'] = df['fuel_load_kg'] - reference_fuel
    df['fuel_correction_s'] = (df['fuel_delta_kg'] * k).round(4)
    
    # Corrected time: remove the fuel penalty/benefit
    df['LapTime_fuel_corrected'] = (df['LapTime_s'] - df['fuel_correction_s']).round(3)
    
    return df


def get_fuel_params():
    """Return fuel model parameters for JSON export."""
    return {
        'sensitivity_s_per_kg': FUEL_SENSITIVITY,
        'max_fuel_kg': MAX_RACE_FUEL_KG,
        'burn_rate_kg_per_lap': round(RACE_BURN_RATE, 3),
        'reference_fuel_kg': REFERENCE_FUEL_KG,
        'fp2_burn_rate': FP2_BURN_RATE,
    }


if __name__ == '__main__':
    # Quick test with synthetic data
    from fetch_data import generate_synthetic_practice
    
    practice = generate_synthetic_practice()
    practice = estimate_practice_fuel(practice)
    practice = apply_fuel_correction(practice)
    
    print("Fuel correction applied:")
    print(practice[['Driver', 'LapNumber', 'Compound', 'TyreLife', 
                     'LapTime_s', 'fuel_load_kg', 'fuel_correction_s', 
                     'LapTime_fuel_corrected']].head(15))
    
    print(f"\nMean fuel correction: {practice['fuel_correction_s'].mean():.3f}s")
    print(f"Fuel correction range: {practice['fuel_correction_s'].min():.3f}s to {practice['fuel_correction_s'].max():.3f}s")
