import os
import sys
import numpy as np
import pandas as pd

# ── Configuration ──────────────────────────────────────────────────
YEAR = 2024
PRACTICE_SESSION = 'FP2'
RACE_SESSION = 'R'
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')

TRACK_CONFIGS = {
    'singapore': {
        'GRAND_PRIX': 'Singapore',
        'RACE_LAPS': 62,
        'BASE_LAP_S': { 'SOFT': 100.5, 'MEDIUM': 101.2, 'HARD': 102.0 },
        'TRACK_LENGTH': 5063.0,
        'SPEED_PROFILE': lambda pos: np.clip(180 + 90 * np.sin(pos * 2 * np.pi * 5) + 30 * np.cos(pos * 2 * np.pi * 12), 70, 320),
        'FUEL_BURN_KG': 1.77,
        'NAME': '2024 Singapore Grand Prix',
        'VENUE': 'Marina Bay Street Circuit'
    },
    'monza': {
        'GRAND_PRIX': 'Italy',
        'RACE_LAPS': 53,
        'BASE_LAP_S': { 'SOFT': 82.5, 'MEDIUM': 83.2, 'HARD': 84.0 },
        'TRACK_LENGTH': 5793.0,
        'SPEED_PROFILE': lambda pos: np.clip(250 + 100 * np.sin(pos * 2 * np.pi * 3), 90, 350),
        'FUEL_BURN_KG': 2.05,
        'NAME': '2024 Italian Grand Prix',
        'VENUE': 'Autodromo Nazionale Monza'
    },
    'monaco': {
        'GRAND_PRIX': 'Monaco',
        'RACE_LAPS': 78,
        'BASE_LAP_S': { 'SOFT': 73.0, 'MEDIUM': 73.8, 'HARD': 74.5 },
        'TRACK_LENGTH': 3337.0,
        'SPEED_PROFILE': lambda pos: np.clip(140 + 70 * np.sin(pos * 2 * np.pi * 8), 60, 280),
        'FUEL_BURN_KG': 1.4,
        'NAME': '2024 Monaco Grand Prix',
        'VENUE': 'Circuit de Monaco'
    }
}

def get_track_config(track_id='singapore'):
    return TRACK_CONFIGS.get(track_id, TRACK_CONFIGS['singapore'])

def fetch_fastf1_session(year, gp, session_type):
    """Attempt to load a session via FastF1."""
    try:
        import fastf1
        os.makedirs(CACHE_DIR, exist_ok=True)
        fastf1.Cache.enable_cache(CACHE_DIR)
        session = fastf1.get_session(year, gp, session_type)
        session.load(telemetry=True, weather=False, messages=False)
        return session
    except Exception as e:
        print(f"[WARN] FastF1 fetch failed for {year} {gp} {session_type}: {e}")
        return None


def extract_laps(session):
    """Extract clean lap data from a FastF1 session object."""
    laps = session.laps

    # Filter: accurate laps, green flag only
    mask = laps['IsAccurate'] == True
    if 'TrackStatus' in laps.columns:
        mask = mask & (laps['TrackStatus'].astype(str).str.strip() == '1')

    clean = laps.loc[mask].copy()

    # Convert LapTime timedelta to seconds
    clean['LapTime_s'] = clean['LapTime'].dt.total_seconds()

    # Convert Time (timedelta) to seconds for absolute session time
    if 'Time' in clean.columns:
        clean['SessionTime_s'] = clean['Time'].dt.total_seconds()
    else:
        # Fallback if somehow missing
        clean['SessionTime_s'] = clean['LapNumber'] * 100.0

    # Select relevant columns
    cols = ['Driver', 'LapNumber', 'SessionTime_s', 'LapTime_s', 'Compound', 'TyreLife', 'Stint']
    available = [c for c in cols if c in clean.columns]
    result = clean[available].copy()

    # Drop rows with missing lap times or compound
    result = result.dropna(subset=['LapTime_s', 'Compound'])
    
    # Hard filter gross outliers that IsAccurate missed (e.g. aborted laps >110% of stint median)
    stint_medians = result.groupby(['Driver', 'Stint'])['LapTime_s'].transform('median')
    result = result[result['LapTime_s'] < (stint_medians * 1.1)]
    
    # Classify run types (Race Sim vs Quali)
    # Stints >= 5 laps are considered race simulations (long runs)
    stint_lengths = result.groupby(['Driver', 'Stint'])['TyreLife'].transform('max')
    result = result.copy()
    result['is_race_sim'] = stint_lengths >= 5
    
    result = result.reset_index(drop=True)

    return result


def extract_telemetry(df, session):
    telemetry_dict = {}
    total_laps = len(df)
    print(f"[INFO] Extracting telemetry for {total_laps} laps...")
    for idx, row in df.iterrows():
        driver = row['Driver']
        lap_num = row['LapNumber']
        lap_id = f"{driver}_{lap_num}"
        
        try:
            lap = session.laps.pick_driver(driver).pick_lap(lap_num)
            if hasattr(lap, 'iloc') and len(lap) > 0:
                lap = lap.iloc[0]
            tel = lap.get_telemetry()
            
            if 'Distance' in tel.columns and 'Speed' in tel.columns and 'Time' in tel.columns:
                max_dist = tel['Distance'].max()
                if max_dist > 0:
                    tel['track_position_norm'] = tel['Distance'] / max_dist
                else:
                    tel['track_position_norm'] = 0.0
                
                keep_cols = ['Time', 'SessionTime', 'Distance', 'track_position_norm', 'Speed']
                for c in ['Throttle', 'Brake', 'RPM', 'nGear', 'DRS', 'X', 'Y', 'Z']:
                    if c in tel.columns:
                        keep_cols.append(c)
                
                tel_subset = tel[keep_cols].copy()
                tel_subset['Time_s'] = tel_subset['Time'].dt.total_seconds()
                telemetry_dict[lap_id] = tel_subset
            else:
                telemetry_dict[lap_id] = None
        except Exception as e:
            # Silence per-lap errors to avoid spam, just record None
            telemetry_dict[lap_id] = None
            
    successes = sum(1 for v in telemetry_dict.values() if v is not None)
    print(f"[INFO] Successfully extracted telemetry for {successes}/{total_laps} laps.")
    return telemetry_dict


def generate_synthetic_telemetry(lap_time, true_deg, fuel_effect, track_evo, true_traffic, track_id='singapore'):
    """Generate realistic synthetic speed trace."""
    config = get_track_config(track_id)
    track_length = config['TRACK_LENGTH']
    num_samples = 300
    pos = np.linspace(0, 1, num_samples)
    dist = pos * track_length
    
    base_speed = config['SPEED_PROFILE'](pos)
    speed = base_speed.copy()
    
    # Shift speed based on degradation/fuel/track
    speed -= true_deg * 2.0
    speed += -fuel_effect * 2.0
    speed += -track_evo * 2.0
    
    if true_traffic > 0:
        traffic_start = np.random.uniform(0.1, 0.8)
        traffic_end = traffic_start + np.random.uniform(0.05, 0.15)
        mask = (pos >= traffic_start) & (pos <= traffic_end)
        speed[mask] -= (true_traffic * 15.0)
        speed = np.clip(speed, 60, 340)
        
    tel = pd.DataFrame({
        'Distance': dist,
        'track_position_norm': pos,
        'Speed': speed,
        'Time_s': np.linspace(0, lap_time, num_samples)
    })
    
    accel = np.gradient(speed)
    tel['Throttle'] = np.where(accel > 0, 100, 0)
    tel['Brake'] = np.where(accel < -5, 100, 0)
    return tel


def generate_synthetic_practice(track_id='singapore'):
    """Generate realistic synthetic FP2 long-run data."""
    config = get_track_config(track_id)
    np.random.seed(42)
    rows = []
    telemetry_dict = {}

    drivers = ['VER', 'NOR', 'LEC', 'PIA', 'SAI', 'HAM', 'RUS', 'ALO']
    compounds = ['SOFT', 'MEDIUM', 'HARD']

    stint_id = 0
    for driver in drivers:
        n_stints = np.random.choice([2, 3], p=[0.4, 0.6])
        session_lap = 1
        current_time_s = np.random.uniform(300, 1200) 
        
        for s in range(n_stints):
            stint_id += 1
            compound = np.random.choice(compounds, p=[0.4, 0.4, 0.2])
            stint_len = np.random.randint(5, 14)
            base = config['BASE_LAP_S'][compound] + np.random.normal(0, 0.3)
            driver_offset = np.random.normal(0, 0.5)

            for lap_in_stint in range(1, stint_len + 1):
                tyre_age = lap_in_stint

                if compound == 'SOFT':
                    deg = 0.12 * tyre_age + 0.004 * tyre_age ** 2
                elif compound == 'MEDIUM':
                    deg = 0.07 * tyre_age + 0.0015 * tyre_age ** 2
                else:
                    deg = 0.04 * tyre_age + 0.0005 * tyre_age ** 2

                fuel_remaining = 50 - (lap_in_stint * 1.5)
                fuel_effect = (fuel_remaining - 25) * 0.035
                track_evo = -0.0003 * current_time_s

                traffic = 0
                if np.random.random() < 0.15:
                    traffic = np.random.uniform(0.5, 2.5)

                noise = np.random.normal(0, 0.15)
                lap_time = base + driver_offset + deg + fuel_effect + track_evo + traffic + noise

                lap_id = f"{driver}_{session_lap}"

                rows.append({
                    'Driver': driver,
                    'LapNumber': session_lap,
                    'SessionTime_s': round(current_time_s, 1),
                    'LapTime_s': round(lap_time, 3),
                    'Compound': compound,
                    'TyreLife': tyre_age,
                    'Stint': stint_id,
                    'is_synthetic': True,
                    'lap_id': lap_id,
                    '_true_deg': round(deg, 4),
                    '_fuel_effect': round(fuel_effect, 4),
                    '_traffic': round(traffic, 4),
                })
                
                tel = generate_synthetic_telemetry(lap_time, deg, fuel_effect, track_evo, traffic, track_id)
                telemetry_dict[lap_id] = tel

                session_lap += 1
                current_time_s += lap_time
            
            current_time_s += np.random.uniform(300, 900)

    return pd.DataFrame(rows), telemetry_dict


def generate_synthetic_race(track_id='singapore'):
    """Generate realistic synthetic race data."""
    config = get_track_config(track_id)
    np.random.seed(99)
    rows = []
    telemetry_dict = {}

    drivers = ['VER', 'NOR', 'LEC', 'PIA', 'SAI', 'HAM', 'RUS', 'ALO']
    strategies = [
        [('MEDIUM', 20), ('HARD', 25), ('MEDIUM', 17)],
        [('SOFT', 15), ('MEDIUM', 25), ('HARD', 22)],
        [('MEDIUM', 18), ('HARD', 28), ('SOFT', 16)],
    ]

    for driver in drivers:
        strategy = strategies[np.random.randint(0, len(strategies))]
        driver_offset = np.random.normal(0, 0.4)
        race_lap = 1
        stint_num = 0

        for compound, stint_len in strategy:
            stint_num += 1
            base = config['BASE_LAP_S'][compound]

            for lap_in_stint in range(1, stint_len + 1):
                tyre_age = lap_in_stint

                if compound == 'SOFT':
                    deg = 0.12 * tyre_age + 0.004 * tyre_age ** 2
                elif compound == 'MEDIUM':
                    deg = 0.07 * tyre_age + 0.0015 * tyre_age ** 2
                else:
                    deg = 0.04 * tyre_age + 0.0005 * tyre_age ** 2

                base = config['BASE_LAP_S'][compound]
                fuel_remaining = 110 - ((race_lap) * config['FUEL_BURN_KG'])
                fuel_effect = (fuel_remaining - 55) * 0.035
                track_evo = -0.005 * race_lap

                traffic = 0
                if np.random.random() < 0.10:
                    traffic = np.random.uniform(0.3, 1.5)

                noise = np.random.normal(0, 0.2)
                lap_time = base + driver_offset + deg + fuel_effect + track_evo + traffic + noise

                lap_id = f"{driver}_{race_lap}"

                rows.append({
                    'Driver': driver,
                    'LapNumber': race_lap,
                    'LapTime_s': round(lap_time, 3),
                    'Compound': compound,
                    'TyreLife': tyre_age,
                    'Stint': stint_num,
                    'is_synthetic': True,
                    'lap_id': lap_id,
                    '_true_deg': round(deg, 4),
                    '_fuel_effect': round(fuel_effect, 4),
                    '_track_evo': round(track_evo, 4),
                    '_traffic': round(traffic, 4),
                })
                
                tel = generate_synthetic_telemetry(lap_time, deg, fuel_effect, track_evo, traffic)
                telemetry_dict[lap_id] = tel
                
                race_lap += 1

    return pd.DataFrame(rows), telemetry_dict


def fetch_practice_data(track_id='singapore'):
    """Fetch practice data — real or synthetic."""
    config = get_track_config(track_id)
    grand_prix = config.get('GRAND_PRIX', 'Singapore')
    print(f"[INFO] Attempting to fetch REAL practice data via FastF1 for {grand_prix}...")
    session = fetch_fastf1_session(YEAR, grand_prix, PRACTICE_SESSION)
    if session is not None:
        try:
            df = extract_laps(session)
            race_sims = df[df['is_race_sim']].copy()
            if len(race_sims) > 30:
                print(f"[OK] Loaded {len(race_sims)} real FP2 LONG RUN laps. Using LIVE FastF1 data.")
                race_sims['is_synthetic'] = False
                race_sims['lap_id'] = race_sims['Driver'] + "_" + race_sims['LapNumber'].astype(str)
                telemetry = extract_telemetry(race_sims, session)
                return race_sims, telemetry
            else:
                print(f"[WARN] Only {len(race_sims)} long run laps found in FP2. Falling back.")
        except Exception as e:
            print(f"[WARN] Failed to extract real laps: {e}")

    print("[INFO] Fallback triggered: Using SYNTHETIC FP2 data")
    return generate_synthetic_practice(track_id)


def fetch_race_data(track_id='singapore'):
    """Fetch race data — real or synthetic."""
    config = get_track_config(track_id)
    grand_prix = config.get('GRAND_PRIX', 'Singapore')
    print(f"[INFO] Attempting to fetch REAL race data via FastF1 for {grand_prix}...")
    session = fetch_fastf1_session(YEAR, grand_prix, RACE_SESSION)
    if session is not None:
        try:
            df = extract_laps(session)
            if len(df) > 50:
                print(f"[OK] Loaded {len(df)} real race laps. Using LIVE FastF1 data.")
                df['is_synthetic'] = False
                df['lap_id'] = df['Driver'] + "_" + df['LapNumber'].astype(str)
                telemetry = extract_telemetry(df, session)
                return df, telemetry
        except Exception as e:
            print(f"[WARN] Failed to extract real race laps: {e}")

    print("[INFO] Fallback triggered: Using SYNTHETIC race data")
    return generate_synthetic_race(track_id)


if __name__ == '__main__':
    print("=== Fetching Practice Data ===")
    practice, practice_tel = fetch_practice_data('singapore')
    print(f"Practice: {len(practice)} laps")
    
    print("\n=== Fetching Race Data ===")
    race, race_tel = fetch_race_data('singapore')
    print(f"Race: {len(race)} laps")
