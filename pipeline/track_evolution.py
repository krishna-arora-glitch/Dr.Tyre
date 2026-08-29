"""
track_evolution.py — Track Evolution Modeling

Estimates the session-wide grip improvement trend as rubber gets laid
down on the track surface, then subtracts it from individual lap times.
"""

import numpy as np
import pandas as pd

TRACK_EVOLUTION_SMOOTHING_WINDOW = 5


def estimate_track_evolution(df, time_col='LapTime_fuel_corrected'):
    """
    Estimate track evolution as a session-wide grip trend.
    
    Method:
    1. Group all laps by session lap number
    2. Compute the 25th percentile lap time per session lap (robust to outliers)
    3. Fit a linear trend to this percentile series
    4. The slope represents s/lap improvement from track evolution
    
    Returns the slope and intercept of the linear fit.
    """
    df = df.copy()
    
    # Group by session lap number and compute median
    # (more robust than mean — less affected by slow cars)
    lap_stats = df.groupby('LapNumber')[time_col].median().reset_index()
    lap_stats.columns = ['LapNumber', 'median_time']
    
    # Apply a centered rolling smoothing window
    lap_stats['smoothed_time'] = lap_stats['median_time'].rolling(window=TRACK_EVOLUTION_SMOOTHING_WINDOW, min_periods=1, center=True).mean()
    
    # Drop NaN
    lap_stats = lap_stats.dropna()
    
    if len(lap_stats) < 3:
        print("[WARN] Not enough data for track evolution modeling")
        return 0.0, 0.0, lap_stats
    
    # Linear fit: time = slope × lap_number + intercept
    x = lap_stats['LapNumber'].values
    y = lap_stats['smoothed_time'].values
    
    # Use numpy polyfit (degree 1)
    coeffs = np.polyfit(x, y, 1)
    slope = coeffs[0]   # negative slope = track getting faster
    intercept = coeffs[1]
    
    # Sanity check: track evolution should make the track FASTER (negative slope)
    # If it's positive, it's incorrectly picking up tyre deg or stint phasing
    if slope > 0:
        print(f"[WARN] Track evo slope {slope:.4f} is positive. Forcing to typical -0.01 s/lap.")
        slope = -0.01
    
    print(f"[Track Evo] Slope: {slope:.4f} s/lap (negative = improving)")
    print(f"[Track Evo] Total evolution over session: {slope * (x.max() - x.min()):.2f}s")
    
    return slope, intercept, lap_stats


def apply_track_evolution_correction(df, slope, intercept, time_col='LapTime_fuel_corrected'):
    """
    Remove track evolution effect from lap times.
    
    The trend represents how much the track improved at each lap number.
    We subtract the trend, keeping only lap-1's track state as baseline.
    
    corrected = raw - (trend_at_lap - trend_at_lap_1)
    
    This normalizes all laps to the track state at session start.
    """
    df = df.copy()
    
    # Track evolution delta relative to lap 1
    first_lap = df['LapNumber'].min()
    baseline_trend = slope * first_lap + intercept
    
    df['track_evo_trend'] = slope * df['LapNumber'] + intercept
    df['track_evo_correction_s'] = (df['track_evo_trend'] - baseline_trend).round(4)
    
    # Corrected: remove the track improvement
    # If track improved (negative slope), correction is negative → subtract negative = add back
    df['LapTime_corrected'] = (df[time_col] - df['track_evo_correction_s']).round(3)
    
    return df


def get_track_evo_params(slope, intercept, max_lap):
    """Return track evolution parameters for JSON export."""
    total_evo = slope * max_lap
    return {
        'slope_s_per_lap': round(slope, 5),
        'total_evolution_s': round(total_evo, 3),
        'direction': 'improving' if slope < 0 else 'degrading',
    }


if __name__ == '__main__':
    from fetch_data import generate_synthetic_practice
    from fuel_model import estimate_practice_fuel, apply_fuel_correction
    from traffic_filter import detect_traffic_anomaly, filter_traffic
    
    practice = generate_synthetic_practice()
    practice = estimate_practice_fuel(practice)
    practice = apply_fuel_correction(practice)
    practice = detect_traffic_anomaly(practice)
    clean = filter_traffic(practice, exclude=True)
    
    slope, intercept, lap_stats = estimate_track_evolution(clean)
    corrected = apply_track_evolution_correction(clean, slope, intercept)
    
    print(f"\nTrack evolution params: {get_track_evo_params(slope, intercept, clean['LapNumber'].max())}")
    print("\nCorrected data sample:")
    print(corrected[['Driver', 'LapNumber', 'Compound', 'TyreLife',
                      'LapTime_s', 'LapTime_fuel_corrected', 'track_evo_correction_s',
                      'LapTime_corrected']].head(15))
