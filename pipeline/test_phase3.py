import numpy as np
import pandas as pd
from fuel_model import fit_fuel_effect, estimate_practice_fuel, FUEL_SENSITIVITY

def test_fuel_fitting():
    # Create multiple stints to break collinearity
    # Stint 1: SOFT, 10 laps
    # Stint 2: MEDIUM, 10 laps
    
    np.random.seed(42)
    laps = []
    fuel_load = 55.0
    true_k = 0.040
    
    # Stint 1 (Soft)
    for i in range(1, 11):
        tyre_age = i
        fuel_load -= 1.6
        time = 90.0 + 0.15 * tyre_age + true_k * fuel_load
        laps.append(['SOFT', tyre_age, fuel_load, time])
        
    # Stint 2 (Medium)
    for i in range(1, 11):
        tyre_age = i
        fuel_load -= 1.6
        time = 91.0 + 0.08 * tyre_age + true_k * fuel_load
        laps.append(['MEDIUM', tyre_age, fuel_load, time])
        
    df = pd.DataFrame(laps, columns=['Compound', 'TyreLife', 'fuel_load_kg', 'LapTime_s'])
    
    result = fit_fuel_effect(df)
    # Because fuel_load is a perfect linear combination of the compound dummies and tyrelife,
    # the design matrix is rank-deficient. It should correctly fall back.
    assert result['source'] == 'default'
    assert 'rank-deficient' in result['reason']
    
    # Now create a dataset with independent fuel variation (e.g. from actual telemetry or non-constant burn rates)
    laps_indep = []
    for i in range(1, 11):
        fuel_load = 55.0 - i * 1.6 + np.random.normal(0, 5) # add noise to break collinearity
        time = 90.0 + 0.15 * i + true_k * fuel_load
        laps_indep.append(['SOFT', i, fuel_load, time])
    for i in range(1, 11):
        fuel_load = 40.0 - i * 1.6 + np.random.normal(0, 5)
        time = 91.0 + 0.08 * i + true_k * fuel_load
        laps_indep.append(['MEDIUM', i, fuel_load, time])
        
    df_indep = pd.DataFrame(laps_indep, columns=['Compound', 'TyreLife', 'fuel_load_kg', 'LapTime_s'])
    result_indep = fit_fuel_effect(df_indep)
    
    assert result_indep['source'] == 'fitted'
    assert abs(result_indep['value'] - true_k) < 0.005
    
    # Test insufficient laps
    result_short = fit_fuel_effect(df.iloc[:5])
    assert result_short['source'] == 'default'
    assert 'laps' in result_short['reason'].lower()

    # Test single stint (rank deficient or poor conditioning)
    df_single = pd.DataFrame(laps[:10], columns=['Compound', 'TyreLife', 'fuel_load_kg', 'LapTime_s'])
    result_single = fit_fuel_effect(df_single)
    assert result_single['source'] == 'default'
    
    print("All tests passed.")

if __name__ == '__main__':
    test_fuel_fitting()
