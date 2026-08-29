"""
degradation_model.py — Tyre Degradation Curve Fitting

Fits OLS regression per compound to extract clean degradation curves
after fuel, traffic, and track evolution corrections.
"""

import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import PolynomialFeatures


MIN_FIT_LAPS = 5
MIN_TRUSTED_R2 = 0.50

def fit_degradation_curves(df, time_col='LapTime_corrected'):
    """
    Fit degradation curves per tyre compound.
    
    Model: corrected_lap_time = β₀ + β₁ × tyre_age + β₂ × tyre_age²
    
    Returns dict of compound → model info.
    """
    compounds = df['Compound'].unique()
    models = {}
    
    for compound in sorted(compounds):
        compound_data = df[df['Compound'] == compound].copy()
        
        if len(compound_data) < MIN_FIT_LAPS:
            print(f"[WARN] Skipping {compound}: only {len(compound_data)} clean laps (min {MIN_FIT_LAPS})")
            models[compound] = {
                'trusted': False,
                'fit_available': False,
                'note': f"only {len(compound_data)} clean laps — too few to fit",
                'n_laps': len(compound_data)
            }
            continue
        
        X_raw = compound_data['TyreLife'].values.reshape(-1, 1)
        y = compound_data[time_col].values
        
        # ── Quadratic fit ──
        poly = PolynomialFeatures(degree=2, include_bias=False)
        X_poly = poly.fit_transform(X_raw)
        
        model_quad = LinearRegression()
        model_quad.fit(X_poly, y)
        
        # ── Linear fit (for comparison) ──
        model_linear = LinearRegression()
        model_linear.fit(X_raw, y)
        
        # Extract coefficients
        base_pace = round(model_quad.intercept_, 3)
        deg_linear = round(model_quad.coef_[0], 5)
        deg_quadratic = round(model_quad.coef_[1], 6)
        
        # R² scores
        r2_quad = round(model_quad.score(X_poly, y), 4)
        r2_linear = round(model_linear.score(X_raw, y), 4)
        
        # Predicted values for the curve
        max_age = int(X_raw.max()) + 5
        ages = np.arange(1, max_age + 1).reshape(-1, 1)
        ages_poly = poly.transform(ages)
        predicted = model_quad.predict(ages_poly)
        
        # Degradation delta from fresh tyre (age=1)
        fresh_pace = model_quad.predict(poly.transform(np.array([[1]])))[0]
        deg_deltas = predicted - fresh_pace
        
        # Calculate residuals and residual spread (standard deviation)
        actual_preds = model_quad.predict(X_poly)
        residuals = y - actual_preds
        residual_std = round(float(np.std(residuals)), 4)
        
        # Cliff detection: where quadratic acceleration becomes > 0.1 s/lap²
        cliff_lap = None
        if abs(deg_quadratic) > 0.0001:
            # Second derivative threshold
            for age in range(1, max_age + 1):
                marginal_deg = deg_linear + 2 * deg_quadratic * age
                if marginal_deg > 0.2:  # >0.2 s/lap marginal degradation = cliff
                    cliff_lap = age
                    break
        
        # Confidence gating
        trusted = True
        note = "trusted fit"
        
        # Linear degradation should be positive (lap times get slower). If negative, it's suspicious.
        if deg_linear < 0:
            trusted = False
            note = f"suspicious negative degradation ({deg_linear} s/lap). Possible causes: track-evolution leakage, short stints, noisy data."
            print(f"[WARN] {compound}: {note}")
        elif r2_quad < MIN_TRUSTED_R2:
            trusted = False
            note = f"weak fit (R²={r2_quad:.4f}) — treat as indicative only"
            print(f"[WARN] {compound}: {note}")
        
        # Scatter data for charts
        scatter_ages = compound_data['TyreLife'].tolist()
        scatter_deltas = (compound_data[time_col].values - fresh_pace).tolist()
        
        models[compound] = {
            'base_pace': base_pace,
            'deg_linear': deg_linear,
            'deg_quadratic': deg_quadratic,
            'r2_quadratic': r2_quad,
            'r2_linear': r2_linear,
            'residual_std': residual_std,
            'deg_per_lap_linear': round(model_linear.coef_[0], 5),
            'cliff_lap': cliff_lap,
            'max_age_fitted': int(X_raw.max()),
            'n_laps': len(compound_data),
            'curve_ages': list(range(1, max_age + 1)),
            'curve_deltas': [round(d, 4) for d in deg_deltas.tolist()],
            'curve_predicted': [round(p, 3) for p in predicted.tolist()],
            'scatter_ages': [int(a) for a in scatter_ages],
            'scatter_deltas': [round(d, 4) for d in scatter_deltas],
            'fresh_pace': round(fresh_pace, 3),
            'trusted': trusted,
            'fit_available': True,
            'note': note,
        }
        
        print(f"[{compound}] Base: {base_pace:.2f}s, "
              f"Deg: {deg_linear:.4f} s/lap + {deg_quadratic:.5f} s/lap², "
              f"R²: {r2_quad:.4f}, ResStd: {residual_std:.3f}s, Cliff: lap {cliff_lap}, "
              f"N={len(compound_data)}, Trusted: {trusted}")
    
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
