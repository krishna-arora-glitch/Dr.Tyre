"""
traffic_filter.py — Traffic Detection & Filtering

Detects laps affected by dirty air (traffic) using rolling baseline
anomaly detection and marks them for exclusion from degradation fitting.
"""

import numpy as np
import pandas as pd


# ── Traffic Detection Parameters ──────────────────────────────────
ROLLING_WINDOW = 3       # laps for rolling median baseline
ANOMALY_THRESHOLD = 1.5  # × rolling std to flag traffic
MIN_GAP_DIRTY_AIR = 1.5  # seconds — if gap < this, likely dirty air
TRAFFIC_SLOWDOWN_MIN = 0.5  # minimum slowdown (s) to flag as traffic


def detect_traffic_anomaly(df, time_col='LapTime_fuel_corrected'):
    """
    Detect traffic-affected laps using rolling baseline anomaly detection.
    
    For each driver's stint:
    1. Compute rolling median (3-lap window) as "expected clean pace"
    2. Compute rolling std for threshold
    3. Flag laps significantly slower than expected
    
    Returns df with 'is_traffic' boolean column.
    """
    df = df.copy()
    df['is_traffic'] = False
    df['traffic_delta_s'] = 0.0
    
    for (driver, stint), group in df.groupby(['Driver', 'Stint']):
        if len(group) < ROLLING_WINDOW + 1:
            continue
        
        idx = group.index
        times = group[time_col].values
        
        # Rolling median and std
        series = pd.Series(times)
        rolling_med = series.rolling(window=ROLLING_WINDOW, min_periods=2, center=True).median()
        rolling_std = series.rolling(window=ROLLING_WINDOW, min_periods=2, center=True).std()
        
        # Fill NaN at edges with forward/backward fill
        rolling_med = rolling_med.ffill().bfill()
        rolling_std = rolling_std.ffill().bfill()
        
        # Flag anomalies: lap significantly slower than rolling baseline
        for i, (med, std, actual) in enumerate(zip(rolling_med, rolling_std, times)):
            delta = actual - med
            threshold = max(TRAFFIC_SLOWDOWN_MIN, ANOMALY_THRESHOLD * std) if std > 0 else TRAFFIC_SLOWDOWN_MIN
            
            if delta > threshold:
                df.loc[idx[i], 'is_traffic'] = True
                df.loc[idx[i], 'traffic_delta_s'] = round(delta, 3)
    
    return df


def filter_traffic(df, exclude=True):
    """
    Filter out traffic-affected laps.
    
    If exclude=True, removes traffic laps entirely.
    If exclude=False, keeps them but marks them (for visualization).
    """
    if 'is_traffic' not in df.columns:
        df = detect_traffic_anomaly(df)
    
    n_traffic = df['is_traffic'].sum()
    n_total = len(df)
    pct = (n_traffic / n_total * 100) if n_total > 0 else 0
    
    print(f"[Traffic] Detected {n_traffic}/{n_total} traffic-affected laps ({pct:.1f}%)")
    
    if exclude:
        clean = df[~df['is_traffic']].copy()
        return clean
    else:
        return df


def get_traffic_stats(df):
    """Return traffic detection statistics for reporting."""
    if 'is_traffic' not in df.columns:
        return {'total_laps': len(df), 'traffic_laps': 0, 'pct_traffic': 0}
    
    n_traffic = int(df['is_traffic'].sum())
    n_total = len(df)
    
    return {
        'total_laps': n_total,
        'traffic_laps': n_traffic,
        'pct_traffic': round(n_traffic / n_total * 100, 1) if n_total > 0 else 0,
        'mean_traffic_delta_s': round(df.loc[df['is_traffic'], 'traffic_delta_s'].mean(), 3) if n_traffic > 0 else 0,
    }


if __name__ == '__main__':
    from fetch_data import generate_synthetic_practice
    from fuel_model import estimate_practice_fuel, apply_fuel_correction
    
    practice = generate_synthetic_practice()
    practice = estimate_practice_fuel(practice)
    practice = apply_fuel_correction(practice)
    practice = detect_traffic_anomaly(practice)
    
    stats = get_traffic_stats(practice)
    print(f"Traffic stats: {stats}")
    
    # Show flagged laps
    traffic_laps = practice[practice['is_traffic']]
    print(f"\nTraffic-affected laps ({len(traffic_laps)}):")
    if len(traffic_laps) > 0:
        print(traffic_laps[['Driver', 'LapNumber', 'Compound', 'TyreLife',
                            'LapTime_s', 'LapTime_fuel_corrected', 'traffic_delta_s']].head(10))
