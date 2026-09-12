"""
traffic_filter.py — Traffic Detection & Filtering

Detects laps affected by dirty air (traffic) using both the old rolling 
lap-time baseline anomaly detection, and the new telemetry speed-aware detector.
"""

import numpy as np
import pandas as pd

# ── Old Lap-Time Detector Config ────────────────────────────────────
ROLLING_WINDOW = 3       
ANOMALY_THRESHOLD = 1.5  
MIN_GAP_DIRTY_AIR = 1.5  
TRAFFIC_SLOWDOWN_MIN = 0.5  

# ── New Telemetry Detector Config ──────────────────────────────────
TRAFFIC_MIN_DURATION_S = 1.5       # minimum seconds of slowdown to flag
TRAFFIC_Z_THRESHOLD = -2.5         # Z-score of residual (negative means slower)
TRAFFIC_SEVERE_Z_THRESHOLD = -4.0  # Severe traffic threshold
TRAFFIC_MIN_SPEED_LOSS_KMH = 10.0  # absolute min speed loss to consider
TRAFFIC_RECOVERY_THRESHOLD = -1.0  # Z-score at which traffic event ends


def detect_traffic_anomaly(df, time_col='LapTime_fuel_corrected'):
    """
    [OLD METHOD] Detect traffic-affected laps using rolling baseline lap times.
    """
    df = df.copy()
    df['is_traffic'] = False
    df['traffic_delta_s'] = 0.0
    
    for (driver, stint), group in df.groupby(['Driver', 'Stint']):
        if len(group) < ROLLING_WINDOW + 1:
            continue
        
        idx = group.index
        times = group[time_col].values
        
        max_tyre_life = group['TyreLife'].max()
        for i, row_idx in enumerate(idx):
            tyre_life = group.at[row_idx, 'TyreLife']
            if tyre_life == 1 or tyre_life == max_tyre_life:
                df.loc[row_idx, 'is_traffic'] = True
                df.loc[row_idx, 'traffic_delta_s'] = 9.99 
        
        series = pd.Series(times)
        rolling_med = series.rolling(window=ROLLING_WINDOW, min_periods=2, center=True).median()
        rolling_med = rolling_med.ffill().bfill()
        
        for i, (med, actual) in enumerate(zip(rolling_med, times)):
            row_idx = idx[i]
            if df.loc[row_idx, 'is_traffic']:
                continue
                
            delta = actual - med
            if delta > 1.0:
                df.loc[row_idx, 'is_traffic'] = True
                df.loc[row_idx, 'traffic_delta_s'] = round(delta, 3)
    
    return df


def calculate_local_variation(telemetry_dict, clean_df, position_bins=100):
    """
    Calculates robust local variation (MAD) of speed across the track.
    """
    if clean_df.empty:
        return np.full(position_bins, 10.0) # default variation
        
    all_speeds = []
    all_positions = []
    
    for idx, row in clean_df.iterrows():
        lap_id = row['lap_id']
        tel = telemetry_dict.get(lap_id)
        if tel is not None and not tel.empty:
            all_speeds.append(tel['Speed'].values)
            all_positions.append(tel['track_position_norm'].values)
            
    if not all_speeds:
        return np.full(position_bins, 10.0)
        
    flat_positions = np.concatenate(all_positions)
    flat_speeds = np.concatenate(all_speeds)
    
    bins = np.linspace(0, 1, position_bins + 1)
    bin_indices = np.digitize(flat_positions, bins) - 1
    bin_indices = np.clip(bin_indices, 0, position_bins - 1)
    
    df = pd.DataFrame({'bin': bin_indices, 'speed': flat_speeds})
    # Compute MAD (Median Absolute Deviation) per bin
    mad_per_bin = df.groupby('bin')['speed'].apply(lambda x: np.median(np.abs(x - np.median(x))))
    
    local_mad = np.full(position_bins, 10.0)
    for b in range(position_bins):
        if b in mad_per_bin.index:
            val = mad_per_bin[b]
            local_mad[b] = val if val > 2.0 else 2.0 # minimum variation to avoid div-zero
            
    # Smooth variation
    local_mad = pd.Series(local_mad).rolling(window=3, min_periods=1, center=True).mean().values
    return local_mad


def detect_telemetry_traffic(df, telemetry_dict, speed_model, time_col='LapTime_fuel_corrected'):
    """
    [NEW METHOD] Detects traffic using speed telemetry residuals.
    """
    df = df.copy()
    df['telemetry_traffic_status'] = 'CLEAN'
    df['traffic_score'] = 0.0
    df['traffic_duration_s'] = 0.0
    df['maximum_speed_loss_kmh'] = 0.0
    
    # 1. Hard Boundary Rejection (Out-laps and In-laps)
    # We still flag these as they are not true degradation laps
    df['is_out_lap'] = False
    df['is_in_lap'] = False
    for (driver, stint), group in df.groupby(['Driver', 'Stint']):
        max_tyre_life = group['TyreLife'].max()
        for row_idx in group.index:
            tyre_life = group.at[row_idx, 'TyreLife']
            if tyre_life == 1:
                df.loc[row_idx, 'is_out_lap'] = True
                df.loc[row_idx, 'telemetry_traffic_status'] = 'TRAFFIC' # Exclude
            elif tyre_life == max_tyre_life:
                df.loc[row_idx, 'is_in_lap'] = True
                df.loc[row_idx, 'telemetry_traffic_status'] = 'TRAFFIC' # Exclude

    # Get local variation for Z-scores
    # To prevent leakage, ideally this uses only clean laps from training, 
    # but here we approximate with whatever clean laps we have so far.
    clean_approx = df[(~df['is_out_lap']) & (~df['is_in_lap'])]
    local_mad = calculate_local_variation(telemetry_dict, clean_approx, speed_model.position_bins)
    
    bins = np.linspace(0, 1, speed_model.position_bins + 1)
    
    statuses_clean = 0
    statuses_possible = 0
    statuses_traffic = 0
    
    for idx, row in df.iterrows():
        # Skip if already hard rejected
        if row['telemetry_traffic_status'] == 'TRAFFIC':
            statuses_traffic += 1
            continue
            
        lap_id = row['lap_id']
        tel = telemetry_dict.get(lap_id)
        
        if tel is None or 'speed_residual_kmh' not in tel.columns:
            # Fallback to lap-time anomaly if telemetry is missing
            statuses_clean += 1
            continue
            
        pos = tel['track_position_norm'].values
        bin_indices = np.digitize(pos, bins) - 1
        bin_indices = np.clip(bin_indices, 0, speed_model.position_bins - 1)
        
        lap_mad = local_mad[bin_indices]
        residuals = tel['speed_residual_kmh'].values
        time_s = tel['Time_s'].values
        
        z_scores = residuals / lap_mad
        
        # Traffic event detection
        in_event = False
        event_start_time = 0
        current_event_max_loss = 0
        
        max_loss_lap = 0
        total_traffic_duration = 0
        
        for i in range(len(z_scores)):
            z = z_scores[i]
            loss = -residuals[i] # positive value for speed loss
            
            if not in_event:
                if z < TRAFFIC_Z_THRESHOLD and loss > TRAFFIC_MIN_SPEED_LOSS_KMH:
                    in_event = True
                    event_start_time = time_s[i]
                    current_event_max_loss = loss
            else:
                if loss > current_event_max_loss:
                    current_event_max_loss = loss
                    
                if z > TRAFFIC_RECOVERY_THRESHOLD:
                    # Event over
                    in_event = False
                    duration = time_s[i] - event_start_time
                    if duration >= TRAFFIC_MIN_DURATION_S:
                        total_traffic_duration += duration
                        if current_event_max_loss > max_loss_lap:
                            max_loss_lap = current_event_max_loss
                            
        # Handle event open at end of lap
        if in_event:
            duration = time_s[-1] - event_start_time
            if duration >= TRAFFIC_MIN_DURATION_S:
                total_traffic_duration += duration
                if current_event_max_loss > max_loss_lap:
                    max_loss_lap = current_event_max_loss
                    
        # Classify based on severity and duration
        if total_traffic_duration > 0:
            df.loc[idx, 'traffic_duration_s'] = round(total_traffic_duration, 2)
            df.loc[idx, 'maximum_speed_loss_kmh'] = round(max_loss_lap, 1)
            
            # Simple evidence score
            score = (total_traffic_duration / 2.0) + (max_loss_lap / 20.0)
            df.loc[idx, 'traffic_score'] = round(score, 2)
            
            if score > 3.0 or max_loss_lap > 30.0:
                df.loc[idx, 'telemetry_traffic_status'] = 'TRAFFIC'
                statuses_traffic += 1
            else:
                df.loc[idx, 'telemetry_traffic_status'] = 'POSSIBLE_TRAFFIC'
                statuses_possible += 1
        else:
            statuses_clean += 1

    print(f"[Telemetry Traffic] Clean: {statuses_clean}, Possible: {statuses_possible}, Traffic: {statuses_traffic}")
    return df


def filter_traffic(df, exclude=True, use_telemetry=False):
    """
    Filter out traffic-affected laps using the chosen method.
    """
    if use_telemetry:
        col = 'telemetry_traffic_status'
        if col not in df.columns:
            raise ValueError("Run detect_telemetry_traffic first")
            
        n_traffic = (df[col] == 'TRAFFIC').sum()
        n_possible = (df[col] == 'POSSIBLE_TRAFFIC').sum()
        n_total = len(df)
        print(f"[Filter] Filtering using telemetry: {n_traffic} traffic, {n_possible} possible out of {n_total} laps.")
        
        if exclude:
            # We keep CLEAN and POSSIBLE_TRAFFIC (down-weighting could happen later, but for V1 we keep)
            clean = df[df[col] != 'TRAFFIC'].copy()
            return clean
        else:
            return df
    else:
        # Fallback to old behavior
        if 'is_traffic' not in df.columns:
            df = detect_traffic_anomaly(df)
            
        n_traffic = df['is_traffic'].sum()
        n_total = len(df)
        print(f"[Filter] Filtering using old lap-time method: {n_traffic} traffic out of {n_total} laps.")
        
        if exclude:
            clean = df[~df['is_traffic']].copy()
            return clean
        else:
            return df

def get_traffic_stats(df, use_telemetry=False):
    """Return traffic detection statistics for reporting."""
    n_total = len(df)
    
    if use_telemetry and 'telemetry_traffic_status' in df.columns:
        n_traffic = int((df['telemetry_traffic_status'] == 'TRAFFIC').sum())
        n_possible = int((df['telemetry_traffic_status'] == 'POSSIBLE_TRAFFIC').sum())
        
        return {
            'method': 'speed_residual',
            'statuses': {
                'clean': n_total - n_traffic - n_possible,
                'possible': n_possible,
                'traffic': n_traffic
            },
            'thresholds': {
                'min_duration_s': TRAFFIC_MIN_DURATION_S,
                'z_threshold': TRAFFIC_Z_THRESHOLD
            },
            'confidence': 'HIGH'
        }
    else:
        n_traffic = int(df['is_traffic'].sum()) if 'is_traffic' in df.columns else 0
        return {
            'method': 'lap_time_anomaly',
            'statuses': {
                'clean': n_total - n_traffic,
                'possible': 0,
                'traffic': n_traffic
            },
            'thresholds': {},
            'confidence': 'LOW'
        }
