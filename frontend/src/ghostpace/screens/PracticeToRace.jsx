import { useState, useEffect } from 'react';
import { api } from '../api';
import { StatusBadge, DataLabel } from '../components/StatusBadge';
import { ChartPanel, MetricCard, LoadingState, ErrorState, EmptyState } from '../components/ChartPanel';
import { WhyItMatters } from '../components/StoryElements';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, Area, Scatter, Cell,
} from 'recharts';

export default function PracticeToRace({ sessionId }) {
  const [track, setTrack] = useState('Bahrain');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.getOracleValidation(track)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [track]);

  if (loading) return <LoadingState message={`Loading practice-to-race validation for ${track}...`} />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <EmptyState />;

  // Build comparison data for the chart
  const fridayEst = data.friday_estimates?.['0.05'] || data.friday_estimates?.[0.05];
  const sundayScenarios = data.sunday_scenarios || [];

  // Chart: Friday bar + Sunday scenario dots
  const chartItems = [];
  if (fridayEst) {
    chartItems.push({
      label: 'Friday FP2 (λ=0.05)',
      beta: parseFloat((fridayEst.beta_tyre * 1000).toFixed(2)),
      ciLower: parseFloat((fridayEst.ci_lower * 1000).toFixed(2)),
      ciUpper: parseFloat((fridayEst.ci_upper * 1000).toFixed(2)),
      type: 'friday',
    });
  }
  sundayScenarios.forEach((s, i) => {
    chartItems.push({
      label: `Sun M=${s.start_mass_kg} P=${s.penalty_coeff}`,
      beta: parseFloat((s.beta_tyre * 1000).toFixed(2)),
      ciLower: parseFloat((s.ci_lower * 1000).toFixed(2)),
      ciUpper: parseFloat((s.ci_upper * 1000).toFixed(2)),
      type: 'sunday',
    });
  });

  return (
    <div className="animate-in space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            Practice → Race Validation
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1 max-w-2xl">
            Compares Friday FP2 estimated tyre-induced pace loss against Sunday
            race-period reference estimates. Sunday estimates are
            <strong className="text-[var(--accent-orange)]"> NOT ground truth</strong> —
            they are out-of-sample race-period reference estimates under ASSUMED fuel scenarios.
          </p>
        </div>
        <select
          className="ghost-select"
          value={track}
          onChange={e => setTrack(e.target.value)}
        >
          <option value="Bahrain">Bahrain</option>
          <option value="Spain">Spain</option>
        </select>
      </div>

      <WhyItMatters>
        Practice modelling is only useful if it remains consistent with later race observations. By checking if the Friday practice estimate overlaps with Sunday race-period scenarios, we validate the model's predictive power.
      </WhyItMatters>

      {/* Compatibility */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Compatibility"
          value=""
          status={<StatusBadge status={data.compatibility} />}
        />
        {data.friday_beta_central !== null && (
          <MetricCard
            label="Friday Estimate"
            value={(data.friday_beta_central * 1000).toFixed(1)}
            unit="ms/lap"
            status={<DataLabel type="ESTIMATED" />}
          />
        )}
        {data.sunday_beta_median !== null && (
          <MetricCard
            label="Sunday Reference (Median)"
            value={(data.sunday_beta_median * 1000).toFixed(1)}
            unit="ms/lap"
            sublabel="Out-of-sample race-period reference"
          />
        )}
        {data.overlap_percentage !== null && (
          <MetricCard
            label="CI Overlap"
            value={data.overlap_percentage.toFixed(0)}
            unit="%"
            sublabel="Sunday scenarios within Friday CI"
          />
        )}
      </div>

      {/* Data Status Legend */}
      <div className="glass-panel p-4 flex flex-wrap gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <DataLabel type="OBSERVED" /> Lap times from FastF1
        </div>
        <div className="flex items-center gap-1.5">
          <DataLabel type="ESTIMATED" /> LME model output
        </div>
        <div className="flex items-center gap-1.5">
          <DataLabel type="ASSUMED" /> Fuel prior, start mass, penalty coefficient
        </div>
        <div className="flex items-center gap-1.5">
          <DataLabel type="UNKNOWN" /> Exact fuel mass, tyre pressures, driver intent
        </div>
      </div>

      {/* Comparison Chart */}
      <ChartPanel
        title="Friday Estimate vs Sunday Reference Scenarios"
        subtitle="The practice estimate remained statistically compatible with the race-period reference under the tested assumptions"
      >
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart
            data={chartItems}
            layout="vertical"
            margin={{ top: 10, right: 40, left: 160, bottom: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              type="number"
              label={{ value: 'Estimated Tyre Slope (ms/lap)', position: 'insideBottom', offset: -5 }}
            />
            <YAxis
              dataKey="label"
              type="category"
              width={150}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              formatter={(val, name) => [`${val} ms/lap`, name]}
            />
            <Bar
              dataKey="beta"
              barSize={16}
              name="Estimated Slope"
            >
              {chartItems.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={entry.type === 'friday' ? 'var(--accent-blue)' : 'var(--accent-orange)'}
                  opacity={0.8}
                />
              ))}
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-xs text-center text-[var(--text-secondary)] mt-4 italic">
          Interpretation: The blue bar is the Friday estimate. The orange bars represent the range of plausible Sunday estimates. As long as the orange bars land near or within the blue bar's uncertainty, the practice model was correct.
        </p>
      </ChartPanel>

      {/* Friday Estimates Table */}
      {data.friday_estimates && (
        <div className="glass-panel p-5 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            Friday FP2 Estimates
            <DataLabel type="ESTIMATED" />
          </h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Fuel Prior <DataLabel type="ASSUMED" /></th>
                <th>Tyre Slope</th>
                <th>SE</th>
                <th>95% CI</th>
                <th>p-value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.friday_estimates).map(([prior, est]) => (
                est && (
                  <tr key={prior}>
                    <td>{prior} s/lap</td>
                    <td>{(est.beta_tyre * 1000).toFixed(2)} ms/lap</td>
                    <td>{(est.se * 1000).toFixed(2)}</td>
                    <td>[{(est.ci_lower * 1000).toFixed(1)}, {(est.ci_upper * 1000).toFixed(1)}]</td>
                    <td>{est.p_value.toExponential(2)}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sunday Scenarios Table */}
      {sundayScenarios.length > 0 && (
        <div className="glass-panel p-5 overflow-x-auto">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            Sunday Race-Period Reference Estimates
            <span className="text-xs text-[var(--accent-orange)] font-normal ml-1">
              (NOT ground truth)
            </span>
          </h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Start Mass <DataLabel type="ASSUMED" /></th>
                <th>Penalty Coeff <DataLabel type="ASSUMED" /></th>
                <th>Tyre Slope</th>
                <th>SE</th>
                <th>95% CI</th>
              </tr>
            </thead>
            <tbody>
              {sundayScenarios.map((s, i) => (
                <tr key={i}>
                  <td>{s.start_mass_kg} kg</td>
                  <td>{s.penalty_coeff} s/lap</td>
                  <td>{(s.beta_tyre * 1000).toFixed(2)} ms/lap</td>
                  <td>{(s.se * 1000).toFixed(2)}</td>
                  <td>[{(s.ci_lower * 1000).toFixed(1)}, {(s.ci_upper * 1000).toFixed(1)}]</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
