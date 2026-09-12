import os
import json
import numpy as np
import pandas as pd

def get_telemetry_dict(telemetry_dict_raw, target_samples=150):
    """
    Downsamples telemetry and returns a dictionary structure:
    {
      "Driver": {
        "LapNumber": [
          { "track_position_norm": 0.0, "Speed": 182.0, ... },
          ...
        ]
      }
    }
    """
    telemetry = {}
    
    if not telemetry_dict_raw:
        return telemetry
        
    for lap_id, df in telemetry_dict_raw.items():
        if df is None or len(df) == 0:
            continue
            
        # lap_id is expected to be like "VER_15" or "VER_15.0"
        parts = str(lap_id).split('_')
        if len(parts) >= 2:
            driver = parts[0]
            try:
                lap_num = str(int(float(parts[1])))
            except ValueError:
                lap_num = parts[1]
        else:
            driver = "UNKNOWN"
            lap_num = "1"
            
        if driver not in telemetry:
            telemetry[driver] = {}
            
        # Downsample
        n = len(df)
        if n > target_samples:
            indices = np.linspace(0, n - 1, target_samples, dtype=int)
            sampled_df = df.iloc[indices].copy()
        else:
            sampled_df = df.copy()
            
        # Calculate ExpectedSpeed
        if 'Speed' in sampled_df.columns and 'speed_residual_kmh' in sampled_df.columns:
            sampled_df['ExpectedSpeed'] = sampled_df['Speed'] - sampled_df['speed_residual_kmh']
        else:
            sampled_df['ExpectedSpeed'] = sampled_df['Speed'] if 'Speed' in sampled_df.columns else None
            
        sampled_df = sampled_df.replace({np.nan: None})
        
        # Convert to list of records
        cols_to_keep = ['track_position_norm', 'Speed', 'ExpectedSpeed', 'speed_residual_kmh', 
                        'Throttle', 'Brake', 'nGear', 'DRS', 'lap_stress', 'traffic']
                        
        available_cols = [c for c in cols_to_keep if c in sampled_df.columns]
        records = sampled_df[available_cols].to_dict('records')
        
        telemetry[driver][lap_num] = records
        
    return telemetry
