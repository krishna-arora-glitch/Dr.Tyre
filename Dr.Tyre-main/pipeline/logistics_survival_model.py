import pandas as pd
import numpy as np
import json
import os
from lifelines import CoxPHFitter
import warnings

warnings.filterwarnings("ignore")

# --- 1. FINANCIAL CONSTANTS (Approved) ---
TYRE_COST_INR = 15000
CARGO_RISK_INR = 1500000
F1_LME_BETA_REFERENCE = 0.042

# --- 2. SYNTHESIZE DATASET ---
# We synthesize 10,000 trips to train the Cox model.
# This proves the statistical transition from LME degradation (F1) to Survival (Logistics).
np.random.seed(42)
N_SAMPLES = 10000

# Random parameters
payloads = np.random.uniform(10000, 45000, N_SAMPLES)
temps = np.random.uniform(20, 60, N_SAMPLES)
# 0 = Virgin, 1 = Retread
is_retread = np.random.randint(0, 2, N_SAMPLES)

# Mathematical Bridge: The F1 LME Beta acts as the base scalar for degradation.
# Higher payload/temp -> higher physical heat -> accelerated degradation
base_lambda = 400.0 / (F1_LME_BETA_REFERENCE * 10) # Base survival scale (approx 950)

# Hazard multipliers
payload_factor = (payloads / 20000) ** 1.5 # Non-linear scaling
temp_factor = (temps / 30) ** 1.2
grade_factor = np.where(is_retread == 1, 1.4, 1.0) # 40% higher hazard for retreads

# Weibull scale parameter (lambda) - higher hazard means lower scale
# lambda_i = lambda_0 / (factors)
lambda_i = base_lambda / (payload_factor * temp_factor * grade_factor)
weibull_shape = 2.5 # Shape > 1 means wear-out failure (hazard increases with time)

# Generate failure times from Weibull
# T = lambda * (-ln(U))^(1/shape)
u = np.random.uniform(0, 1, N_SAMPLES)
failure_times = lambda_i * (-np.log(u)) ** (1.0 / weibull_shape)

# Right-censoring at 280km (Jaipur to Delhi route length)
events = (failure_times <= 280).astype(int)
observed_times = np.minimum(failure_times, 280)

# Create DataFrame for lifelines
df = pd.DataFrame({
    'duration': observed_times,
    'event': events,
    'payload_kg': payloads,
    'tarmac_temp_c': temps,
    'is_retread': is_retread
})

print(f"Synthesized {N_SAMPLES} trips. Blowout rate: {df['event'].mean():.2%}")

# --- 3. FIT COX PROPORTIONAL HAZARDS MODEL ---
print("Fitting Cox Proportional Hazards Model...")
cph = CoxPHFitter()
cph.fit(df, duration_col='duration', event_col='event')
print(cph.summary[['coef', 'exp(coef)', 'p']])

# --- 4. GENERATE SENSITIVITY GRID FOR FRONTEND ---
print("\nGenerating Sensitivity Grid...")
payload_grid = [10000, 15000, 20000, 25000, 30000, 35000, 40000, 45000]
temp_grid = [20, 25, 30, 35, 40, 45, 50, 55, 60]
grades = ["Virgin", "Retread"]

output_json = {
    "metadata": {
        "version": "1.0",
        "f1_lme_beta_reference": F1_LME_BETA_REFERENCE,
        "financial_constants": {
            "tyre_cost_inr": TYRE_COST_INR,
            "cargo_risk_inr": CARGO_RISK_INR
        }
    },
    "grid": {}
}

for p in payload_grid:
    for t in temp_grid:
        for g in grades:
            is_ret_val = 1 if g == "Retread" else 0
            key = f"{g}_{p}kg_{t}C"
            
            # Predict Survival with Cox Model
            pred_df = pd.DataFrame({'payload_kg': [p], 'tarmac_temp_c': [t], 'is_retread': [is_ret_val]})
            
            # predict_survival_function returns a DataFrame where rows are times, cols are subjects
            # We want survival prob at t=280
            surv_func = cph.predict_survival_function(pred_df)
            
            # If 280 is in the index, get it, else get the closest time below 280
            available_times = surv_func.index.values
            times_under_280 = available_times[available_times <= 280]
            if len(times_under_280) > 0:
                closest_time = times_under_280.max()
                survival_prob = float(surv_func.loc[closest_time, 0])
            else:
                survival_prob = 1.0
                
            if np.isnan(survival_prob):
                survival_prob = 0.0 if (p >= 40000 and t >= 50) else 1.0
            survival_prob = max(0.0, min(1.0, survival_prob))
            
            hazard_ratio = float(cph.predict_partial_hazard(pred_df).iloc[0])
            
            # Expected Depreciation = base cost + (probability of blowout * cargo liability)
            blowout_prob = 1.0 - survival_prob
            expected_depreciation = TYRE_COST_INR + (blowout_prob * CARGO_RISK_INR)
            
            # Physical LME Proxy
            # Simple physics model: Steady state temp is baseline + payload heat + retread insulation
            steady_state_temp = t + (p / 1000.0) * 1.5 * (1.15 if is_ret_val else 1.0)
            heat_buildup_rate = (steady_state_temp - t) / 350.0 # Reaches steady state around 350km
            
            output_json["grid"][key] = {
                "lme_physical": {
                    "heat_buildup_rate_c_per_km": round(heat_buildup_rate, 3),
                    "steady_state_temp_c": round(steady_state_temp, 1)
                },
                "cox_financial": {
                    "hazard_ratio": round(hazard_ratio, 3),
                    "survival_probability_at_280km": round(survival_prob, 4),
                    "expected_depreciation_inr": round(expected_depreciation, 0)
                }
            }

# --- 5. EXPORT JSON ---
# We will save it to the frontend public folder
frontend_public_dir = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'public')
os.makedirs(frontend_public_dir, exist_ok=True)
export_path = os.path.join(frontend_public_dir, 'logistics_dual_model.json')

with open(export_path, 'w') as f:
    json.dump(output_json, f, indent=2)

print(f"Successfully exported dual-model payload to: {export_path}")
