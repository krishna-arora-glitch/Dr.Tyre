import unittest
import numpy as np
import pandas as pd
from degradation_model import fit_degradation_curves
from track_evolution import estimate_track_evolution

class TestPhase2(unittest.TestCase):
    def test_minimum_laps(self):
        # Create dummy df with 4 laps (< MIN_FIT_LAPS=5)
        df = pd.DataFrame({
            'Driver': ['VER']*4,
            'Compound': ['SOFT']*4,
            'TyreLife': [1, 2, 3, 4],
            'LapTime_corrected': [90, 91, 92, 93]
        })
        models = fit_degradation_curves(df)
        self.assertFalse(models['SOFT']['trusted'])
        self.assertFalse(models['SOFT']['fit_available'])
        self.assertIn('only 4 clean laps', models['SOFT']['note'])

    def test_negative_degradation(self):
        # Create dummy df with negative degradation (getting faster)
        df = pd.DataFrame({
            'Driver': ['VER']*10,
            'Compound': ['SOFT']*10,
            'TyreLife': list(range(1, 11)),
            'LapTime_corrected': [90 - (0.5 * i) for i in range(1, 11)]
        })
        models = fit_degradation_curves(df)
        self.assertTrue(models['SOFT']['fit_available'])
        self.assertFalse(models['SOFT']['trusted'])
        self.assertIn('suspicious negative degradation', models['SOFT']['note'])

    def test_valid_lme_fit(self):
        # Create positive degradation with multiple drivers for LME
        df = pd.DataFrame({
            'Driver': ['VER']*10 + ['HAM']*10,
            'Compound': ['MEDIUM']*20,
            'TyreLife': list(range(1, 11)) + list(range(1, 11)),
            'LapTime_corrected': [90 + 0.15 * i for i in range(1, 11)] + [90.5 + 0.15 * i for i in range(1, 11)]
        })
        models = fit_degradation_curves(df)
        self.assertTrue(models['MEDIUM']['fit_available'])
        self.assertTrue(models['MEDIUM']['trusted'])
        self.assertIn('trusted fit (LME)', models['MEDIUM']['note'])
        self.assertGreater(models['MEDIUM']['deg_linear'], 0.05)

    def test_track_evolution_smoothing(self):
        # median + smoothed track evo
        df = pd.DataFrame({
            'SessionTime_s': [300 * i for i in range(1, 11)],
            'LapNumber': [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
            'LapTime_fuel_corrected': [100, 100, 99, 99, 98, 98, 97, 97, 96, 96]
        })
        slope, intercept, lap_stats = estimate_track_evolution(df)
        self.assertTrue(slope < 0)
        self.assertIn('smoothed_time', lap_stats.columns)

if __name__ == '__main__':
    unittest.main()

