import numpy as np
import pandas as pd

class LapStressModel:
    def __init__(self):
        self.features = {}
        
    def compute_workloads(self, df, telemetry_dict):
        """
        Computes raw physical workload features for each lap.
        """
        braking_loads = []
        longitudinal_loads = []
        cornering_loads = []
        speed_loads = []
        thermal_loads = []
        avg_speeds = []
        
        for idx, row in df.iterrows():
            lap_id = row['lap_id']
            tel = telemetry_dict.get(lap_id)
            
            if tel is not None and not tel.empty:
                # Speed is in km/h, time in seconds
                speed_ms = tel['Speed'] / 3.6
                
                # Calculate time step dt
                time_s = tel['Time_s'].values
                dt = np.gradient(time_s)
                # prevent division by zero for identical timestamps
                dt = np.where(dt == 0, 0.001, dt)
                
                # Smooth speed slightly before differentiating to avoid huge noise spikes
                speed_ms_smooth = pd.Series(speed_ms).rolling(window=3, min_periods=1, center=True).mean().values
                
                accel = np.gradient(speed_ms_smooth) / dt
                
                # Braking load: integral of negative acceleration
                a_brake = np.where(accel < 0, accel, 0)
                braking_load = np.sum(np.abs(a_brake) * dt)
                
                # Longitudinal load: integral of absolute acceleration
                long_load = np.sum(np.abs(accel) * dt)
                
                # Cornering load: v^2 / R
                if 'X' in tel.columns and 'Y' in tel.columns:
                    x = pd.Series(tel['X'].values).rolling(window=5, min_periods=1, center=True).mean().values
                    y = pd.Series(tel['Y'].values).rolling(window=5, min_periods=1, center=True).mean().values
                    dx = np.gradient(x)
                    dy = np.gradient(y)
                    ddx = np.gradient(dx)
                    ddy = np.gradient(dy)
                    curvature = np.abs(dx * ddy - dy * ddx) / ((dx**2 + dy**2)**1.5 + 1e-6)
                    a_lat = (speed_ms_smooth**2) * curvature
                    corner_load = np.sum(np.abs(a_lat) * dt)
                else:
                    corner_load = np.nan
                    
                # Speed load: integral of high speed (e.g. > 250 km/h = 69.4 m/s)
                speed_excess = np.where(speed_ms_smooth > 69.4, speed_ms_smooth - 69.4, 0)
                speed_load = np.sum(speed_excess * dt)
                
                # Thermal load: continuous physical thermal energy integral across telemetry
                # Heat generation increases continuously with speed, braking, and cornering loads
                curr_heat = 0.0
                heat_integral = 0.0
                GAMMA_COOL = 0.045
                BETA_SPEED = 2.5
                
                # Speed in km/h
                tel_speed_kmh = speed_ms_smooth * 3.6
                for s_kmh, d, a_b in zip(tel_speed_kmh, dt, a_brake):
                    # Progressive speed factor above 140 km/h
                    speed_factor = max(0.0, (s_kmh - 140.0) / 160.0)
                    speed_heat = BETA_SPEED * (speed_factor ** 1.5)
                    # Braking and cornering load friction contributions
                    brake_heat = 1.2 * min(1.0, abs(a_b) / 15.0)
                    corner_heat = 0.8 * min(1.0, (s_kmh / 250.0) ** 2)
                    
                    heat_rate = speed_heat + brake_heat + corner_heat
                    cool_rate = GAMMA_COOL * curr_heat
                    
                    curr_heat = max(0.0, curr_heat + (heat_rate - cool_rate) * d)
                    heat_integral += curr_heat * d
                thermal_load = heat_integral
                
                avg_speed = tel['Speed'].mean()
                
                braking_loads.append(braking_load)
                longitudinal_loads.append(long_load)
                cornering_loads.append(corner_load)
                speed_loads.append(speed_load)
                thermal_loads.append(thermal_load)
                avg_speeds.append(avg_speed)
            else:
                braking_loads.append(np.nan)
                longitudinal_loads.append(np.nan)
                cornering_loads.append(np.nan)
                speed_loads.append(np.nan)
                thermal_loads.append(np.nan)
                avg_speeds.append(np.nan)
                
        df_out = df.copy()
        df_out['braking_load'] = braking_loads
        df_out['longitudinal_load'] = longitudinal_loads
        df_out['cornering_load'] = cornering_loads
        df_out['speed_load'] = speed_loads
        df_out['thermal_load'] = thermal_loads
        df_out['average_speed'] = avg_speeds
        
        return df_out
        
    def normalize_and_compute_stress(self, df):
        """
        Normalizes workload features using robust Z-score (median/IQR) and computes LapStress.
        Includes the thermal variable with calibrated weights summing to 1.00.
        """
        df_out = df.copy()
        for col in ['braking_load', 'longitudinal_load', 'cornering_load', 'speed_load', 'thermal_load']:
            median_val = df_out[col].median()
            # If all are NaN (e.g. no telemetry), fallback to 0
            if pd.isna(median_val):
                median_val = 0.0
            df_out[col] = df_out[col].fillna(median_val)
            
            # Robust Z-score
            q75, q25 = np.percentile(df_out[col], [75, 25])
            iqr = q75 - q25
            if iqr == 0:
                iqr = 1.0 # prevent div by zero
                
            df_out[f'{col}_z'] = (df_out[col] - median_val) / iqr

        wB = 0.30
        wL = 0.20
        wC = 0.25
        wS = 0.10
        wT = 0.15  # Thermal variable weight (sustained high speed without cooldown)
        
        df_out['lap_stress'] = (
            wB * df_out['braking_load_z'] +
            wL * df_out['longitudinal_load_z'] +
            wC * df_out['cornering_load_z'] +
            wS * df_out['speed_load_z'] +
            wT * df_out['thermal_load_z']
        )
        
        self.features = {
            'weights': {'braking': wB, 'longitudinal': wL, 'cornering': wC, 'speed': wS, 'thermal': wT},
            'normalization': 'robust_zscore'
        }
        
        return df_out

    def get_metadata(self):
        return {
            'enabled': True,
            'normalization': self.features.get('normalization', 'robust_zscore'),
            'weights': self.features.get('weights', {})
        }
