import os
import sys

# Ensure pipeline dir is in path
sys.path.append(os.path.dirname(__file__))

from pipeline.fetch_data import fetch_practice_data, fetch_race_data, CACHE_DIR

print("\n" + "="*50)
print("VERIFICATION: DATA PROVENANCE CHECK")
print("="*50)

print(f"1. FastF1 Cache Directory: {os.path.abspath(CACHE_DIR)}")
print(f"2. Cache Directory Exists: {os.path.exists(CACHE_DIR)}")
print(f"3. Internet access assumed (running script).")
print("-"*50)

print("--- FETCHING PRACTICE DATA (FP2) ---")
try:
    df_practice = fetch_practice_data()
    is_synth_prac = df_practice['is_synthetic'].iloc[0]
    print(f"\n=> RESULT (PRACTICE): {'SYNTHETIC FALLBACK' if is_synth_prac else 'REAL FASTF1 DATA'}")
    if not is_synth_prac:
        drivers = df_practice['Driver'].unique()
        print(f"   Laps pulled: {len(df_practice)}")
        print(f"   Drivers included: {drivers}")
except Exception as e:
    print(f"\n=> RESULT (PRACTICE): FATAL ERROR - {e}")

print("-"*50)
print("--- FETCHING RACE DATA ---")
try:
    df_race = fetch_race_data()
    is_synth_race = df_race['is_synthetic'].iloc[0]
    print(f"\n=> RESULT (RACE): {'SYNTHETIC FALLBACK' if is_synth_race else 'REAL FASTF1 DATA'}")
    if not is_synth_race:
        drivers = df_race['Driver'].unique()
        print(f"   Laps pulled: {len(df_race)}")
        print(f"   Drivers included: {drivers}")
except Exception as e:
    print(f"\n=> RESULT (RACE): FATAL ERROR - {e}")

print("="*50)
