"""
fetch_data.py — FastF1 Data Fetching + Synthetic Fallback

Fetches practice (FP2) and race lap data for the 2024 Singapore GP.
Falls back to realistic synthetic data if FastF1 is unavailable.
"""

import os
import sys
import numpy as np
import pandas as pd

# ── Configuration ──────────────────────────────────────────────────
YEAR = 2024
GRAND_PRIX = 'Singapore'
PRACTICE_SESSION = 'FP2'  # FP2 has the most representative long runs
RACE_SESSION = 'R'
CACHE_DIR = os.path.join(os.path.dirname(__file__), 'cache')

# Singapore GP approximate parameters
SINGAPORE_BASE_LAP_S = {
    'SOFT': 100.5,
    'MEDIUM': 101.2,
    'HARD': 102.0,
}
RACE_LAPS = 62


def fetch_fastf1_session(year, gp, session_type):
    """Attempt to load a session via FastF1."""
    try:
        import fastf1
        os.makedirs(CACHE_DIR, exist_ok=True)
        fastf1.Cache.enable_cache(CACHE_DIR)
        session = fastf1.get_session(year, gp, session_type)
        session.load()
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

    # Select relevant columns
    cols = ['Driver', 'LapNumber', 'LapTime_s', 'Compound', 'TyreLife', 'Stint']
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


def generate_synthetic_practice():
    """Generate realistic synthetic FP2 long-run data for Singapore GP."""
    np.random.seed(42)
    rows = []

    drivers = ['VER', 'NOR', 'LEC', 'PIA', 'SAI', 'HAM', 'RUS', 'ALO']
    compounds = ['SOFT', 'MEDIUM', 'HARD']

    stint_id = 0
    for driver in drivers:
        # Each driver does 2-3 stints in FP2
        n_stints = np.random.choice([2, 3], p=[0.4, 0.6])
        session_lap = 1
        for s in range(n_stints):
            stint_id += 1
            compound = np.random.choice(compounds, p=[0.4, 0.4, 0.2])
            stint_len = np.random.randint(5, 14)  # 5-13 laps per stint
            base = SINGAPORE_BASE_LAP_S[compound] + np.random.normal(0, 0.3)

            # Driver skill offset
            driver_offset = np.random.normal(0, 0.5)

            for lap_in_stint in range(1, stint_len + 1):
                tyre_age = lap_in_stint

                # True degradation (what we want to recover)
                if compound == 'SOFT':
                    deg = 0.12 * tyre_age + 0.004 * tyre_age ** 2
                elif compound == 'MEDIUM':
                    deg = 0.07 * tyre_age + 0.0015 * tyre_age ** 2
                else:
                    deg = 0.04 * tyre_age + 0.0005 * tyre_age ** 2

                # Fuel effect (lighter over stint — makes car faster)
                fuel_remaining = 50 - (lap_in_stint * 1.5)  # FP2 starts ~50 kg
                fuel_effect = (fuel_remaining - 25) * 0.035  # ref = 25 kg

                # Track evolution (session improves over time)
                track_evo = -0.03 * session_lap  # ~0.03s improvement per session lap

                # Traffic (random — ~15% of laps)
                traffic = 0
                if np.random.random() < 0.15:
                    traffic = np.random.uniform(0.5, 2.5)

                # Noise
                noise = np.random.normal(0, 0.15)

                lap_time = base + driver_offset + deg + fuel_effect + track_evo + traffic + noise

                rows.append({
                    'Driver': driver,
                    'LapNumber': session_lap,
                    'LapTime_s': round(lap_time, 3),
                    'Compound': compound,
                    'TyreLife': tyre_age,
                    'Stint': stint_id,
                    'is_synthetic': True,
                    '_true_deg': round(deg, 4),
                    '_fuel_effect': round(fuel_effect, 4),
                    '_track_evo': round(track_evo, 4),
                    '_traffic': round(traffic, 4),
                })
                session_lap += 1

    return pd.DataFrame(rows)


def generate_synthetic_race():
    """Generate realistic synthetic race data for Singapore GP."""
    np.random.seed(99)
    rows = []

    drivers = ['VER', 'NOR', 'LEC', 'PIA', 'SAI', 'HAM', 'RUS', 'ALO']

    # Typical Singapore strategies: 2-stop or 3-stop
    strategies = [
        [('MEDIUM', 20), ('HARD', 25), ('MEDIUM', 17)],  # 2-stop
        [('SOFT', 15), ('MEDIUM', 25), ('HARD', 22)],     # 2-stop
        [('MEDIUM', 18), ('HARD', 28), ('SOFT', 16)],     # 2-stop
    ]

    for driver in drivers:
        strategy = strategies[np.random.randint(0, len(strategies))]
        driver_offset = np.random.normal(0, 0.4)
        race_lap = 1
        stint_num = 0

        for compound, stint_len in strategy:
            stint_num += 1
            base = SINGAPORE_BASE_LAP_S[compound]

            for lap_in_stint in range(1, stint_len + 1):
                tyre_age = lap_in_stint

                # Degradation
                if compound == 'SOFT':
                    deg = 0.12 * tyre_age + 0.004 * tyre_age ** 2
                elif compound == 'MEDIUM':
                    deg = 0.07 * tyre_age + 0.0015 * tyre_age ** 2
                else:
                    deg = 0.04 * tyre_age + 0.0005 * tyre_age ** 2

                # Fuel effect (start at 110 kg, burn 1.77/lap)
                fuel_remaining = 110 - (race_lap * 1.77)
                fuel_effect = (fuel_remaining - 55) * 0.035  # ref = mid-race

                # Track evolution (less dramatic in race, track is already rubbered in)
                track_evo = -0.005 * race_lap

                # Traffic (more frequent in race, ~25%)
                traffic = 0
                if np.random.random() < 0.10:
                    traffic = np.random.uniform(0.3, 1.5)

                # Noise
                noise = np.random.normal(0, 0.2)

                lap_time = base + driver_offset + deg + fuel_effect + track_evo + traffic + noise

                rows.append({
                    'Driver': driver,
                    'LapNumber': race_lap,
                    'LapTime_s': round(lap_time, 3),
                    'Compound': compound,
                    'TyreLife': tyre_age,
                    'Stint': stint_num,
                    'is_synthetic': True,
                    '_true_deg': round(deg, 4),
                    '_fuel_effect': round(fuel_effect, 4),
                    '_track_evo': round(track_evo, 4),
                    '_traffic': round(traffic, 4),
                })
                race_lap += 1

    return pd.DataFrame(rows)


def fetch_practice_data():
    """Fetch practice data — real or synthetic."""
    print("[INFO] Attempting to fetch REAL practice data via FastF1...")
    session = fetch_fastf1_session(YEAR, GRAND_PRIX, PRACTICE_SESSION)
    if session is not None:
        try:
            df = extract_laps(session)
            
            # For practice, we only want race simulations (long runs)
            # Otherwise quali sims (low fuel, high power) ruin the track evolution and deg models
            race_sims = df[df['is_race_sim']].copy()
            
            if len(race_sims) > 30:
                print(f"[OK] Loaded {len(race_sims)} real FP2 LONG RUN laps. Using LIVE FastF1 data.")
                race_sims['is_synthetic'] = False
                return race_sims
            else:
                print(f"[WARN] Only {len(race_sims)} long run laps found in FP2. Falling back.")
        except Exception as e:
            print(f"[WARN] Failed to extract real laps: {e}")

    print("[INFO] Fallback triggered: Using SYNTHETIC FP2 data (calibrated to Singapore GP)")
    return generate_synthetic_practice()


def fetch_race_data():
    """Fetch race data — real or synthetic."""
    print("[INFO] Attempting to fetch REAL race data via FastF1...")
    session = fetch_fastf1_session(YEAR, GRAND_PRIX, RACE_SESSION)
    if session is not None:
        try:
            df = extract_laps(session)
            if len(df) > 50:
                print(f"[OK] Loaded {len(df)} real race laps. Using LIVE FastF1 data.")
                df['is_synthetic'] = False
                return df
        except Exception as e:
            print(f"[WARN] Failed to extract real race laps: {e}")

    print("[INFO] Fallback triggered: Using SYNTHETIC race data (calibrated to Singapore GP)")
    return generate_synthetic_race()


if __name__ == '__main__':
    print("=== Fetching Practice Data ===")
    practice = fetch_practice_data()
    print(f"Practice: {len(practice)} laps, compounds: {practice['Compound'].unique()}")
    print(practice.head(10))

    print("\n=== Fetching Race Data ===")
    race = fetch_race_data()
    print(f"Race: {len(race)} laps, compounds: {race['Compound'].unique()}")
    print(race.head(10))
