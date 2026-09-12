"""
degradation_model.py — Tyre Degradation Curve Fitting

Fits OLS regression per compound to extract clean degradation curves
after fuel, traffic, and track evolution corrections.
"""

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf


MIN_FIT_LAPS = 5
MIN_TRUSTED_R2 = 0.50

def fit_degradation_curves(df, time_col='LapTime_corrected', use_stress=False):
    """
    Fit degradation curves per tyre compound.
    
    Model: corrected_lap_time ~ tyre_age + (stress) + (1 | Driver)
    
    Returns dict of compound → model info.
    """
    compounds = df['Compound'].unique()
    models = {}
    
    # 1. Fuel-Prior Pre-Adjustment
    # We add 0.05s per lap of stint age to compensate for the fact the car gets lighter.
    # This completely breaks the collinearity between fuel burn and tyre wear.
    LAMBDA_FUEL = 0.05 
    
    df_fit = df.copy()
    # Always build AdjLapTime from the track-evolution corrected time
    df_fit['AdjLapTime'] = df_fit[time_col] + (LAMBDA_FUEL * df_fit['TyreLife'])
    
    # Ensure MEDIUM is processed first to serve as the anchor
    compounds_list = list(compounds)
    if 'MEDIUM' in compounds_list:
        compounds_list.insert(0, compounds_list.pop(compounds_list.index('MEDIUM')))
        
    for compound in compounds_list:
        compound_data = df_fit[df_fit['Compound'] == compound].copy()
        
        # Helper function to apply Pirelli structural fallback
        def apply_structural_fallback(cmp, reason):
            if cmp != 'MEDIUM' and 'MEDIUM' in models and models['MEDIUM']['fit_available']:
                print(f"[FALLBACK] Applying Pirelli structural multipliers for {cmp} ({reason})")
                med = models['MEDIUM']
                
                if cmp == 'SOFT':
                    true_deg_linear = med['deg_linear'] * 1.4
                    fresh_pace = med['fresh_pace'] - 0.6
                elif cmp == 'HARD':
                    true_deg_linear = med['deg_linear'] * 0.7
                    fresh_pace = med['fresh_pace'] + 0.6
                else:
                    true_deg_linear = med['deg_linear']
                    fresh_pace = med['fresh_pace']
                
                max_age = 25
                ages = list(range(1, max_age + 1))
                deg_deltas = [(true_deg_linear * age) for age in ages]
                curve_predicted = [round(fresh_pace + d, 3) for d in deg_deltas]
                models[cmp] = {
                    'base_pace': round(fresh_pace, 3),
                    'deg_linear': round(true_deg_linear, 5),
                    'deg_linear_bse': 0.0,
                    'deg_linear_ci': [round(true_deg_linear, 5), round(true_deg_linear, 5)],
                    'deg_quadratic': 0.0,
                    'r2_quadratic': med['r2_quadratic'] if 'r2_quadratic' in med else 0.0,
                    'r2_linear': med['r2_linear'] if 'r2_linear' in med else 0.0,
                    'residual_std': med['residual_std'],
                    'deg_per_lap_linear': round(true_deg_linear, 5),
                    'cliff_lap': None,
                    'max_age_fitted': max_age,
                    'n_laps': len(compound_data),
                    'curve_ages': ages,
                    'curve_deltas': [round(d, 4) for d in deg_deltas],
                    'curve_predicted': curve_predicted,
                    'scatter_ages': [],
                    'scatter_deltas': [],
                    'fresh_pace': round(fresh_pace, 3),
                    'trusted': False,
                    'fit_available': True,
                    'note': f"Fallback logic applied ({reason})",
                    'lme_summary': 'Structural Fallback'
                }
            else:
                models[cmp] = {
                    'trusted': False,
                    'fit_available': False,
                    'note': reason,
                    'n_laps': len(compound_data)
                }

        if len(compound_data) < MIN_FIT_LAPS:
            print(f"[WARN] Skipping {compound}: only {len(compound_data)} clean laps")
            apply_structural_fallback(compound, f"only {len(compound_data)} clean laps")
            continue
            
        # 2. Quadratic LME for Cliff Detection
        # AdjLapTime ~ TyreLife + TyreLife_Sq + (lap_stress)
        try:
            compound_data = compound_data.copy()
            compound_data['TyreLife_Sq'] = compound_data['TyreLife'] ** 2
            
            if use_stress and 'lap_stress' in compound_data.columns:
                formula = "AdjLapTime ~ TyreLife + TyreLife_Sq + lap_stress"
            else:
                formula = "AdjLapTime ~ TyreLife + TyreLife_Sq"
                
            model = smf.mixedlm(formula, compound_data, groups=compound_data["Driver"])
            result = model.fit(method='lbfgs')
            track_evo = 0.0
                
            # Extract coefficients
            deg_linear = round(result.params['TyreLife'], 5)
            deg_linear_bse = round(result.bse['TyreLife'], 5)
            deg_linear_ci_raw = result.conf_int().loc['TyreLife'].tolist()
            deg_quadratic = round(result.params['TyreLife_Sq'], 6)
            
            base_pace_raw = result.params['Intercept']
            
            # Convert back to raw pace scale (removing the lambda injection)
            true_deg_linear = round(deg_linear - LAMBDA_FUEL, 5)
            true_deg_linear_ci = [round(c - LAMBDA_FUEL, 5) for c in deg_linear_ci_raw]
            
            max_age = int(compound_data['TyreLife'].max()) + 5
            ages = list(range(1, max_age + 1))
            
            # Calculate curve deltas
            deg_deltas = [(true_deg_linear * age + deg_quadratic * (age ** 2)) for age in ages]
            
            # Residuals calculation
            predictions = result.predict(compound_data)
            residuals = compound_data['AdjLapTime'] - predictions
            residual_std = round(float(np.std(residuals)), 4)
            
            # Calculate Pseudo-R2
            driver_means = compound_data.groupby('Driver')['AdjLapTime'].transform('mean')
            norm_adj_lap_time = compound_data['AdjLapTime'] - driver_means + compound_data['AdjLapTime'].mean()
            r_matrix = np.corrcoef(predictions, norm_adj_lap_time)
            r2_linear = round(float(r_matrix[0, 1]**2), 4) if not np.isnan(r_matrix[0, 1]) else 0.0
            
            # Confidence gating
            trusted = True
            note = "trusted fit (LME)"
            if true_deg_linear < 0:
                trusted = False
                note = f"suspicious negative degradation ({true_deg_linear} s/lap)."
                
            # Find cliff lap (Changepoint Analysis)
            # A cliff occurs when the tyre starts dropping off significantly faster than its linear baseline.
            # We trigger the cliff when the quadratic component adds an extra 0.10s/lap to the degradation rate.
            cliff_lap = None
            cliff_detected = False
            cliff_confidence = "NONE"
            
            if trusted and deg_quadratic > 0.005:
                for age in ages:
                    extra_rate = 2 * deg_quadratic * age
                    if extra_rate > 0.10:
                        cliff_lap = age
                        cliff_detected = True
                        cliff_confidence = "HIGH" if r2_linear > 0.4 else "LOW"
                        break
                
            # Calculate residuals and reconstruct average curve
            fresh_pace = base_pace_raw 
            
            scatter_ages = compound_data['TyreLife'].tolist()
            # For scatter, subtract driver-specific intercepts to normalize
            try:
                re_dict = result.random_effects
                re_mean = float(np.mean([float(v['Group']) for v in re_dict.values()]))
                fresh_pace += re_mean
            except Exception as e:
                print(f"[WARN] Could not extract random effects: {e}")
                re_dict = {}
                
            # If the fixed intercept was near 0 and we failed to get random effects,
            # or if the base pace is just completely unphysical (e.g., < 50s for a 100s lap)
            if fresh_pace < 50.0:
                # Fallback: estimate base pace from the empirical data
                fresh_pace = float(compound_data['AdjLapTime'].mean()) - (true_deg_linear * float(compound_data['TyreLife'].mean()))
                
            curve_predicted = [round(fresh_pace + d, 3) for d in deg_deltas]
            
            scatter_deltas = []
            for _, row in compound_data.iterrows():
                driver_re = re_dict[row['Driver']]['Group'] if row['Driver'] in re_dict else 0
                normalized_adj_lap = row['AdjLapTime'] - driver_re
                normalized_raw_lap = normalized_adj_lap - (LAMBDA_FUEL * row['TyreLife'])
                scatter_deltas.append(round(normalized_raw_lap - fresh_pace, 4))
                
            # Bootstrapped Bayesian Uncertainty Bands (Parametric Bootstrap from LME Covariance)
            # We draw 1000 samples from the multivariate normal distribution of the LME parameters
            try:
                cov_matrix = result.cov_params().loc[['TyreLife', 'TyreLife_Sq'], ['TyreLife', 'TyreLife_Sq']]
                params_mean = [result.params['TyreLife'], result.params['TyreLife_Sq']]
                sampled_params = np.random.multivariate_normal(params_mean, cov_matrix, 1000)
                boot_curves = []
                for sp in sampled_params:
                    sp_linear = sp[0] - LAMBDA_FUEL
                    sp_quad = sp[1]
                    b_curve = [fresh_pace + sp_linear * a + sp_quad * (a ** 2) for a in ages]
                    boot_curves.append(b_curve)
                boot_curves_arr = np.array(boot_curves)
                lower_band = [round(v, 3) for v in np.percentile(boot_curves_arr, 5, axis=0)]
                upper_band = [round(v, 3) for v in np.percentile(boot_curves_arr, 95, axis=0)]
            except Exception as e:
                print(f"[WARN] Parametric bootstrap failed: {e}")
                lower_band = curve_predicted
                upper_band = curve_predicted
                
            models[compound] = {
                'base_pace': round(fresh_pace, 3),
                'deg_linear': true_deg_linear,
                'deg_linear_bse': deg_linear_bse,
                'deg_linear_ci': true_deg_linear_ci,
                'deg_quadratic': deg_quadratic,
                'r2_quadratic': r2_linear,
                'r2_linear': r2_linear,
                'residual_std': residual_std,
                'deg_per_lap_linear': true_deg_linear,
                'stress_coef': round(result.params['lap_stress'], 4) if use_stress and 'lap_stress' in result.params else 0.0,
                'cliff_lap': cliff_lap,
                'cliff_detected': cliff_detected,
                'cliff_confidence': cliff_confidence,
                'max_age_fitted': int(compound_data['TyreLife'].max()),
                'n_laps': len(compound_data),
                'curve_ages': ages,
                'curve_deltas': [round(d, 4) for d in deg_deltas],
                'curve_predicted': curve_predicted,
                'curve_lower_band': lower_band,
                'curve_upper_band': upper_band,
                'scatter_ages': [int(a) for a in scatter_ages],
                'scatter_deltas': scatter_deltas,
                'fresh_pace': round(fresh_pace, 3),
                'trusted': trusted,
                'fit_available': True,
                'note': note,
                'lme_summary': str(result.summary()) # Store for diagnostics
            }
            
            print(f"[{compound}] LME Base: {fresh_pace:.2f}s, "
                  f"True Deg: {true_deg_linear:.4f} s/lap, "
                  f"ResStd: {residual_std:.3f}s, "
                  f"N={len(compound_data)}, Trusted: {trusted}")
                  
        except Exception as e:
            print(f"[ERROR] LME fit failed for {compound}: {e}")
            apply_structural_fallback(compound, f"LME fit failed: {e}")
            
    return models


def predict_lap_time(models, compound, tyre_age, fuel_load_kg=55.0,
                     fuel_sensitivity=0.035, reference_fuel=55.0):
    """
    Predict a lap time for a given compound and tyre age,
    optionally adjusting for fuel load.
    """
    if compound not in models:
        return None
    
    m = models[compound]
    
    # Base prediction from degradation curve
    predicted = m['base_pace'] + m['deg_linear'] * tyre_age + m['deg_quadratic'] * tyre_age ** 2
    
    # Fuel adjustment
    fuel_delta = (fuel_load_kg - reference_fuel) * fuel_sensitivity
    predicted += fuel_delta
    
    return round(predicted, 3)


def get_compound_color(compound):
    """Return F1-standard compound colors."""
    colors = {
        'SOFT': '#FF3333',
        'MEDIUM': '#FFD700',
        'HARD': '#FFFFFF',
        'INTERMEDIATE': '#43B02A',
        'WET': '#0072CE',
    }
    return colors.get(compound, '#888888')


if __name__ == '__main__':
    from fetch_data import generate_synthetic_practice
    from fuel_model import estimate_practice_fuel, apply_fuel_correction
    from traffic_filter import detect_traffic_anomaly, filter_traffic
    from track_evolution import estimate_track_evolution, apply_track_evolution_correction
    
    # Run full pipeline
    practice = generate_synthetic_practice()
    practice = estimate_practice_fuel(practice)
    practice = apply_fuel_correction(practice)
    practice = detect_traffic_anomaly(practice)
    clean = filter_traffic(practice, exclude=True)
    
    slope, intercept, _ = estimate_track_evolution(clean)
    corrected = apply_track_evolution_correction(clean, slope, intercept)
    
    models = fit_degradation_curves(corrected)
    
    # Test prediction
    for compound in ['SOFT', 'MEDIUM', 'HARD']:
        if compound in models:
            for age in [1, 5, 10, 15, 20]:
                pred = predict_lap_time(models, compound, age)
                if pred:
                    delta = pred - models[compound]['fresh_pace']
                    print(f"  {compound} age {age:2d}: {pred:.3f}s (Δ{delta:+.3f}s)")
