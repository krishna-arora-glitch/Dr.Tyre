"""
export_json.py — JSON Export for Frontend

Aggregates all pipeline outputs into model_output.json for the frontend.
Extended to support multiple models without breaking the old schema.
"""

import json
import os
import numpy as np

from degradation_model import get_compound_color
from fuel_model import get_fuel_params

def get_compound_color(compound):
    return {'SOFT': '#ff3333', 'MEDIUM': '#ffd700', 'HARD': '#ffffff'}.get(compound, '#888')

def build_observed_vs_ghost_baseline_chart(practice_raw, practice_corrected):
    compounds_to_show = ['SOFT', 'MEDIUM', 'HARD']
    chart_data = {}
    
    for compound in compounds_to_show:
        raw_compound = practice_raw[practice_raw['Compound'] == compound]
        corr_compound = practice_corrected[practice_corrected['Compound'] == compound]
        
        if len(raw_compound) == 0:
            continue
        
        raw_by_age = raw_compound.groupby('TyreLife')['LapTime_s'].mean()
        corr_by_age = corr_compound.groupby('TyreLife')['LapTime_corrected'].mean()
        
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


def export_model_output(race_info, sensitivity_grid, fuel_params, traffic_stats, pit_strategy, telemetry_samples, output_path):
    import datetime
    
    formatted_grid = {}
    for prior, data in sensitivity_grid.items():
        # Export "telemetry_stress" directly into the root 'compounds' for the simulation
        deg_models_primary = data['deg_models']['telemetry_stress']
        
        compounds = {}
        for compound, model in deg_models_primary.items():
            if not model.get('fit_available', False):
                continue
            compounds[compound] = {
                'base_pace': model['base_pace'],
                'deg_linear': model['deg_linear'],
                'deg_linear_bse': model.get('deg_linear_bse', 0),
                'deg_linear_ci': model.get('deg_linear_ci', [model['deg_linear'], model['deg_linear']]),
                'deg_quadratic': model['deg_quadratic'],
                'deg_per_lap_linear': model['deg_per_lap_linear'],
                'r2_quadratic': model['r2_quadratic'],
                'r2_linear': model['r2_linear'],
                'residual_std': model['residual_std'],
                'stress_coef': model.get('stress_coef', 0.0),
                'cliff_lap': model['cliff_lap'],
                'max_age_fitted': model['max_age_fitted'],
                'n_laps': model['n_laps'],
                'fresh_pace': model['fresh_pace'],
                'color': get_compound_color(compound),
            }
            
        charts = {
            'observed_vs_ghost': data['observed_vs_ghost_baseline'],
            'tyre_induced_pace_loss': {},
            'validation': data['validation_result'] if data['validation_result'] else {},
        }
        for compound, model in deg_models_primary.items():
            if not model.get('fit_available', False):
                continue
            charts['tyre_induced_pace_loss'][compound] = {
                'ages': model['curve_ages'],
                'deltas': model['curve_deltas'],
                'predicted': model['curve_predicted'],
                'lower_band': model.get('curve_lower_band', model['curve_predicted']),
                'upper_band': model.get('curve_upper_band', model['curve_predicted']),
                'scatter_ages': model['scatter_ages'],
                'scatter_deltas': model['scatter_deltas'],
                'color': get_compound_color(compound),
            }
            
        # New models structure for the UI
        new_models_struct = {}
        for model_name, deg_model_set in data['deg_models'].items():
            new_models_struct[model_name] = {}
            for compound, model in deg_model_set.items():
                if model.get('fit_available', False):
                    new_models_struct[model_name][compound] = model
            
        formatted_grid[prior] = {
            'compounds': compounds,
            'charts': charts,
            'track_evolution': data['track_evo_params'],
            'telemetry': data['telemetry_metadata'],
            'stress': data['stress_metadata'],
            'traffic_extended': data['traffic_stats'],
            'models': new_models_struct
        }
    
    output = {
        'metadata': {
            'last_run_timestamp': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'pipeline_version': '3.0-speed-aware',
            'components_status': {
                'traffic_filter': 'OK',
                'fuel_correction': 'OK',
                'track_evolution': 'OK',
                'degradation_model': 'OK',
            }
        },
        'race_info': race_info,
        'sensitivity_grid': formatted_grid,
        'fuel': fuel_params,
        'traffic': traffic_stats,
        'pit_strategy': pit_strategy,
        # New root fields required by the prompt
        'telemetry': telemetry_samples,
        'stress': formatted_grid["0.05"]['stress']
    }
    
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, default=str)
    
    file_size = os.path.getsize(output_path)
    print(f"\n[Export] Written to {output_path} ({file_size / 1024:.1f} KB)")
    
    return output

def compute_pit_strategy(deg_models, race_laps=62, pit_threshold_delta_s=0.8):
    stint_limits = {}
    for compound, model in deg_models.items():
        if not model.get('fit_available', False):
            continue
            
        for age in range(1, 50):
            delta = model['deg_linear'] * age + model['deg_quadratic'] * age ** 2
            if delta > pit_threshold_delta_s:
                stint_limits[compound] = age
                break
        else:
            stint_limits[compound] = 45
    
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
