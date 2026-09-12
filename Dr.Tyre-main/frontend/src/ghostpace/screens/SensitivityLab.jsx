import { useState, useEffect } from 'react';
import { api } from '../api';
import { StatusBadge, DataLabel } from '../components/StatusBadge';
import { ChartPanel, MetricCard, LoadingState, ErrorState, EmptyState } from '../components/ChartPanel';
import { WhyItMatters } from '../components/StoryElements';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ErrorBar,
} from 'recharts';

export default function SensitivityLab({ sessionId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    api.getSensitivity(sessionId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (!sessionId) return <EmptyState message="Select a session to view sensitivity analysis" />;
  if (loading) return <LoadingState message="Sweeping fuel priors..." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <EmptyState />;

  const chartData = data.scenarios
    .filter(s => s.estimated_tyre_slope !== null)
    .map(s => ({
      prior: s.fuel_prior,
      slope: parseFloat((s.estimated_tyre_slope * 1000).toFixed(2)),
      seLower: parseFloat(((s.estimated_tyre_slope - 1.96 * s.tyre_slope_se) * 1000).toFixed(2)),
      seUpper: parseFloat(((s.estimated_tyre_slope + 1.96 * s.tyre_slope_se) * 1000).toFixed(2)),
      rmse: parseFloat(s.in_sample_rmse.toFixed(4)),
    }));

  return (
    <div className="animate-in space-y-6">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          Prior Sensitivity Lab
          <DataLabel type="ASSUMED" />
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          How the estimated tyre-induced pace loss changes under different fuel-prior assumptions.
          The fuel prior is ASSUMED — exact fuel mass is UNKNOWN.
        </p>
      </div>

      <WhyItMatters>
        Public data does not contain exact fuel masses. By sweeping across a range of plausible fuel-prior assumptions, we test whether our conclusion about tyre degradation is robust or just a mathematical artifact of a lucky guess.
      </WhyItMatters>

      {/* Stability Assessment */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard
          label="Prior Stability"
          value=""
          status={<StatusBadge status={data.stability} />}
        />
        {data.slope_range !== null && (
          <MetricCard
            label="Slope Range"
            value={(data.slope_range * 1000).toFixed(1)}
            unit="ms/lap"
            sublabel="Across tested priors"
          />
        )}
        {data.slope_cv !== null && (
          <MetricCard
            label="Coefficient of Variation"
            value={(data.slope_cv * 100).toFixed(1)}
            unit="%"
            sublabel="Lower = more stable"
          />
        )}
      </div>

      {/* Chart */}
      <ChartPanel
        title="Estimated Tyre Slope vs Fuel Prior"
        subtitle="Each point is a separate LME fit under a different ASSUMED fuel-prior. Error bars show 95% CI."
      >
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="prior"
              label={{ value: 'Fuel Prior (s/lap) — ASSUMED', position: 'insideBottom', offset: -5 }}
              type="number"
              domain={[0.02, 0.08]}
              tickCount={4}
            />
            <YAxis
              label={{ value: 'Estimated Tyre Slope (ms/lap)', angle: -90, position: 'insideLeft', offset: 10 }}
            />
            <Tooltip
              formatter={(val, name) => [`${val}`, name]}
              labelFormatter={l => `λ = ${l} s/lap (ASSUMED)`}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="slope"
              stroke="var(--chart-line-1)"
              strokeWidth={2.5}
              dot={{ r: 5, fill: 'var(--chart-line-1)', strokeWidth: 2 }}
              name="Estimated Slope"
            />
            <Line
              type="monotone"
              dataKey="seLower"
              stroke="var(--chart-line-1)"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              name="95% CI Lower"
            />
            <Line
              type="monotone"
              dataKey="seUpper"
              stroke="var(--chart-line-1)"
              strokeWidth={1}
              strokeDasharray="4 4"
              dot={false}
              name="95% CI Upper"
            />
          </LineChart>
        </ResponsiveContainer>
        <p className="text-xs text-center text-[var(--text-secondary)] mt-4 italic">
          Interpretation: If the estimated slope (solid line) remains consistently positive and stable across the tested priors, the degradation signal is robust against fuel assumptions.
        </p>
      </ChartPanel>

      {/* Scenario Table */}
      <div className="glass-panel p-5 overflow-x-auto">
        <h3 className="text-sm font-semibold mb-3">Scenario Detail</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Fuel Prior <DataLabel type="ASSUMED" /></th>
              <th>Tyre Slope <DataLabel type="ESTIMATED" /></th>
              <th>SE</th>
              <th>95% CI</th>
              <th>p-value</th>
              <th>In-Sample RMSE</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.scenarios.map(s => (
              <tr key={s.fuel_prior}>
                <td>{s.fuel_prior} s/lap</td>
                <td>{s.estimated_tyre_slope !== null ? (s.estimated_tyre_slope * 1000).toFixed(2) + ' ms/lap' : '—'}</td>
                <td>{s.tyre_slope_se !== null ? (s.tyre_slope_se * 1000).toFixed(2) : '—'}</td>
                <td>
                  {s.tyre_slope_ci_lower !== null
                    ? `[${(s.tyre_slope_ci_lower * 1000).toFixed(1)}, ${(s.tyre_slope_ci_upper * 1000).toFixed(1)}]`
                    : '—'}
                </td>
                <td>{s.tyre_slope_p_value !== null ? s.tyre_slope_p_value.toExponential(2) : '—'}</td>
                <td>{s.in_sample_rmse !== null ? s.in_sample_rmse.toFixed(4) + ' s' : '—'}</td>
                <td><StatusBadge status={s.model_status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
