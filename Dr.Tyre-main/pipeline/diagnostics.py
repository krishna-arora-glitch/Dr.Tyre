import pandas as pd
from fetch_data import fetch_practice_data
from fuel_model import estimate_practice_fuel, apply_fuel_correction
from traffic_filter import detect_traffic_anomaly, filter_traffic

print("Fetching practice data...")
practice = fetch_practice_data()
print("Estimating fuel...")
practice = estimate_practice_fuel(practice)
print("Applying fuel correction...")
practice = apply_fuel_correction(practice)

print("\n--- Raw vs Corrected Lap Times per Stint ---")
# Group by driver and stint to see what's happening
for driver in ['VER', 'NOR']:
    driver_laps = practice[practice['Driver'] == driver].sort_values('LapNumber')
    for stint, stint_laps in driver_laps.groupby('Stint'):
        print(f"Driver {driver} Stint {stint}: {len(stint_laps)} laps, Fuel Load: {stint_laps['fuel_load_kg'].iloc[0]} kg")
        print(stint_laps[['LapNumber', 'TyreLife', 'Compound', 'LapTime_s', 'LapTime_fuel_corrected']].head(3))
