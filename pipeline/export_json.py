"""
export_json.py — JSON Export for Frontend

Aggregates all pipeline outputs into model_output.json for the frontend.
"""

import json
import os
import numpy as np

from degradation_model import get_compound_color
from fuel_model import get_fuel_params


def build_observed_vs_ghost_baseline_chart(practice_raw, practice_corrected):
    """
    Build data for the Observed vs Ghost Baseline chart.
    Shows actual lap times versus the counterfactual baseline.
    """
    # Aggregate by tyre age: mean raw and corrected times
    # Pick a representative compound (MEDIUM)
    compounds_to_show = ['SOFT', 'MEDIUM', 'HARD']
    chart_data = {}
    
    for compound in compounds_to_show:
        raw_compound = practice_raw[practice_raw['Compound'] == compound]
        corr_compound = practice_corrected[practice_corrected['Compound'] == compound]
        
        if len(raw_compound) == 0:
            continue
        
        # Group by tyre age
        raw_by_age = raw_compound.groupby('TyreLife')['LapTime_s'].mean()
        corr_by_age = corr_compound.groupby('TyreLife')['LapTime_corrected'].mean()
        
        # Align on common ages
        common_ages = sorted(set(raw_by_age.index) & set(corr_by_age.index))
        
        if not common_ages:
            continue
        
        chart_data[compound] = {
            'ages': [int(a) for a in common_ages],
            'observed': [round(raw_by_age[a], 3) for a in common_ages],
            'ghost_baseline': [round(corr_by_age[a], 3) for a in common_ages],
            'color': get_compound_color(compound),
        }
    
    return chart_data


def export_model_output(race_info, deg_models, fuel_params, track_evo_params,
                        traffic_stats, validation_result, observed_vs_ghost_baseline,
                        pit_strategy, output_path):
    """
    Export all pipeline results as a single JSON file.
    """
    # Build compounds section
    compounds = {}
    for compound, model in deg_models.items():
        compounds[compound] = {
            'base_pace': model['base_pace'],
            'deg_linear': model['deg_linear'],
            'deg_quadratic': model['deg_quadratic'],
            'deg_per_lap_linear': model['deg_per_lap_linear'],
            'r2_quadratic': model['r2_quadratic'],
            'r2_linear': model['r2_linear'],
            'residual_std': model['residual_std'],
            'cliff_lap': model['cliff_lap'],
            'max_age_fitted': model['max_age_fitted'],
            'n_laps': model['n_laps'],
            'fresh_pace': model['fresh_pace'],
            'color': get_compound_color(compound),
        }
    
    # Build charts section
    charts = {
        'observed_vs_ghost': observed_vs_ghost_baseline,
        'tyre_induced_pace_loss': {},
        'validation': validation_result if validation_result else {},
    }
    
    for compound, model in deg_models.items():
        charts['tyre_induced_pace_loss'][compound] = {
            'ages': model['curve_ages'],
            'deltas': model['curve_deltas'],
            'predicted': model['curve_predicted'],
            'scatter_ages': model['scatter_ages'],
            'scatter_deltas': model['scatter_deltas'],
            'color': get_compound_color(compound),
        }
    
    output = {
        'race_info': race_info,
        'compounds': compounds,
        'fuel': fuel_params,
        'track_evolution': track_evo_params,
        'traffic': traffic_stats,
        'charts': charts,
        'pit_strategy': pit_strategy,
        'metadata': {
            'pipeline_version': '1.0',
            'model_type': 'OLS quadratic',
            'notes': 'Fuel load and traffic exposure are estimated/approximated from public data.',
            'last_run_timestamp': str(np.datetime64('now')),
        }
    }
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, default=str)
    
    file_size = os.path.getsize(output_path)
    print(f"\n[Export] Written to {output_path} ({file_size / 1024:.1f} KB)")
    
    return output


def compute_pit_strategy(deg_models, race_laps=62, pit_threshold_delta_s=0.8):
    """
    Compute simple optimal pit strategy based on degradation curves.
    
    Logic: pit when cumulative degradation delta exceeds threshold.
    """
    # Find optimal stint lengths per compound
    stint_limits = {}
    for compound, model in deg_models.items():
        for age in range(1, 50):
            delta = model['deg_linear'] * age + model['deg_quadratic'] * age ** 2
            if delta > pit_threshold_delta_s:
                stint_limits[compound] = age
                break
        else:
            stint_limits[compound] = 45  # default max
    
    # Simple 2-stop strategy: MEDIUM → HARD → MEDIUM
    strategies = []
    
    if 'MEDIUM' in stint_limits and 'HARD' in stint_limits:
        s1 = min(stint_limits.get('MEDIUM', 20), 22)
        s2 = min(stint_limits.get('HARD', 30), 28)
        s3 = race_laps - s1 - s2
        strategies.append({
            'name': 'Balanced 2-Stop',
            'stints': [
                {'compound': 'MEDIUM', 'laps': s1},
                {'compound': 'HARD', 'laps': s2},
                {'compound': 'MEDIUM', 'laps': max(s3, 10)},
            ],
            'pit_laps': [s1, s1 + s2],
        })
    
    if 'SOFT' in stint_limits and 'HARD' in stint_limits:
        s1 = min(stint_limits.get('SOFT', 12), 15)
        s2 = min(stint_limits.get('HARD', 30), 30)
        s3 = race_laps - s1 - s2
        strategies.append({
            'name': 'Aggressive 2-Stop',
            'stints': [
                {'compound': 'SOFT', 'laps': s1},
                {'compound': 'HARD', 'laps': s2},
                {'compound': 'MEDIUM', 'laps': max(s3, 10)},
            ],
            'pit_laps': [s1, s1 + s2],
        })
    
    return {
        'pit_threshold_delta_s': pit_threshold_delta_s,
        'stint_limits': stint_limits,
        'strategies': strategies,
        'optimal_pit_laps': strategies[0]['pit_laps'] if strategies else [20, 40],
    }
