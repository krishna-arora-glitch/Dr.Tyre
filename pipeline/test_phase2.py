import unittest
import numpy as np
import pandas as pd
from degradation_model import fit_degradation_curves
from track_evolution import estimate_track_evolution

class TestPhase2(unittest.TestCase):
    def test_minimum_laps(self):
        # Create dummy df with 4 laps
        df = pd.DataFrame({
            'Compound': ['SOFT']*4,
            'TyreLife': [1, 2, 3, 4],
            'LapTime_corrected': [90, 91, 92, 93]
        })
        models = fit_degradation_curves(df)
        self.assertFalse(models['SOFT']['trusted'])
        self.assertFalse(models['SOFT']['fit_available'])
        self.assertIn('only 4 clean laps', models['SOFT']['note'])

    def test_negative_degradation(self):
        # Create dummy df with negative deg (getting faster)
        df = pd.DataFrame({
            'Compound': ['SOFT']*10,
            'TyreLife': list(range(1, 11)),
            'LapTime_corrected': [90 - i for i in range(1, 11)]
        })
        models = fit_degradation_curves(df)
        self.assertFalse(models['SOFT']['trusted'])
        self.assertIn('suspicious negative degradation', models['SOFT']['note'])

    def test_low_r2(self):
        # Create very noisy dummy df (low R2)
        np.random.seed(42)
        df = pd.DataFrame({
            'Compound': ['SOFT']*20,
            'TyreLife': list(range(1, 21)),
            'LapTime_corrected': 90 + 1.0 * np.arange(1, 21) + np.random.normal(0, 15, 20)
        })
        models = fit_degradation_curves(df)
        # Should fit but be untrusted due to R2 < 0.50
        self.assertTrue(models['SOFT']['fit_available'])
        self.assertFalse(models['SOFT']['trusted'])
        self.assertIn('weak fit', models['SOFT']['note'])

    def test_high_r2(self):
        # Create perfect fit dummy df
        df = pd.DataFrame({
            'Compound': ['SOFT']*20,
            'TyreLife': list(range(1, 21)),
            'LapTime_corrected': 90 + 0.1 * np.arange(1, 21)
        })
        models = fit_degradation_curves(df)
        self.assertTrue(models['SOFT']['fit_available'])
        self.assertTrue(models['SOFT']['trusted'])

    def test_track_evolution_smoothing(self):
        # median + smoothed track evo
        df = pd.DataFrame({
            'LapNumber': [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
            'LapTime_fuel_corrected': [100, 100, 99, 99, 98, 98, 97, 97, 96, 96]
        })
        slope, intercept, lap_stats = estimate_track_evolution(df)
        self.assertTrue(slope < 0)
        self.assertIn('smoothed_time', lap_stats.columns)

if __name__ == '__main__':
    unittest.main()
