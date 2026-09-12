import numpy as np
import pandas as pd

class SpeedModel:
    def __init__(self, position_bins=100):
        self.position_bins = position_bins
        self.expected_speed_profile = None
        self.confidence = "NONE"
        self.sample_count = 0

    def fit_expected_profile(self, telemetry_dict, clean_laps_df):
        """
        Builds the expected speed profile from clean laps.
        clean_laps_df should contain laps that are considered mostly clean 
        from obvious anomalies (e.g. out laps, in laps).
        """
        if clean_laps_df.empty:
            self.confidence = "LOW"
            self.expected_speed_profile = np.full(self.position_bins, 200.0) # Provisional fallback
            return
            
        all_speeds = []
        all_positions = []
        
        for idx, row in clean_laps_df.iterrows():
            lap_id = row['lap_id']
            tel = telemetry_dict.get(lap_id)
            if tel is not None and not tel.empty:
                all_speeds.append(tel['Speed'].values)
                all_positions.append(tel['track_position_norm'].values)
        
        self.sample_count = len(all_speeds)
        
        if self.sample_count < 3:
            self.confidence = "LOW"
        elif self.sample_count < 10:
            self.confidence = "MEDIUM"
        else:
            self.confidence = "HIGH"
            
        if self.sample_count == 0:
            self.expected_speed_profile = np.full(self.position_bins, 200.0)
            return

        # Flatten and bin
        flat_positions = np.concatenate(all_positions)
        flat_speeds = np.concatenate(all_speeds)
        
        bins = np.linspace(0, 1, self.position_bins + 1)
        bin_indices = np.digitize(flat_positions, bins) - 1
        bin_indices = np.clip(bin_indices, 0, self.position_bins - 1)
        
        df = pd.DataFrame({'bin': bin_indices, 'speed': flat_speeds})
        # Use median for robustness against traffic
        median_speeds = df.groupby('bin')['speed'].median()
        
        profile = np.zeros(self.position_bins)
        for b in range(self.position_bins):
            if b in median_speeds.index:
                profile[b] = median_speeds[b]
            else:
                # Fallback to previous bin
                profile[b] = profile[b-1] if b > 0 else 200.0
                
        # Smooth the median profile slightly
        self.expected_speed_profile = pd.Series(profile).rolling(window=3, min_periods=1, center=True).mean().values

    def calculate_residuals(self, telemetry_dict, df):
        """
        Adds `speed_residual_kmh` to telemetry and returns updated telemetry_dict.
        """
        if self.expected_speed_profile is None:
            raise ValueError("Expected speed profile not fitted.")
            
        bins = np.linspace(0, 1, self.position_bins + 1)
        
        for idx, row in df.iterrows():
            lap_id = row['lap_id']
            tel = telemetry_dict.get(lap_id)
            if tel is not None and not tel.empty:
                pos = tel['track_position_norm'].values
                bin_indices = np.digitize(pos, bins) - 1
                bin_indices = np.clip(bin_indices, 0, self.position_bins - 1)
                
                expected_speed = self.expected_speed_profile[bin_indices]
                tel['speed_residual_kmh'] = tel['Speed'] - expected_speed
                telemetry_dict[lap_id] = tel
                
        return telemetry_dict

    def get_metadata(self):
        return {
            'baseline_source': 'current_session' if self.sample_count >= 3 else 'provisional',
            'baseline_sample_count': self.sample_count,
            'baseline_confidence': self.confidence
        }
