import { useState, useEffect } from 'react';
import { api } from '../api';
import { StatusBadge, DataLabel } from '../components/StatusBadge';
import { ChartPanel, MetricCard, LoadingState, ErrorState, EmptyState } from '../components/ChartPanel';
import { WhyItMatters } from '../components/StoryElements';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Area, ComposedChart, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';

export default function TyreIntelligence({ sessionId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    api.getIntelligence(sessionId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (!sessionId) return <EmptyState message="Select a session to view tyre intelligence" />;
  if (loading) return <LoadingState message="Fitting LME model..." />;
  if (error) return <ErrorState message={error} />;
  if (!data) return <EmptyState />;

  // Build degradation curve data
  const maxTyre = data.tyre_age_range[1];
  const curveData = [];
  for (let t = data.tyre_age_range[0]; t <= maxTyre; t++) {
    const est = data.estimated_tyre_pace_loss_rate * t;
    const ciLower = data.tyre_slope_ci_lower * t;
    const ciUpper = data.tyre_slope_ci_upper * t;
    curveData.push({
      tyreLife: t,
      estimated: parseFloat((est * 1000).toFixed(1)),
      ciLower: parseFloat((ciLower * 1000).toFixed(1)),
      ciUpper: parseFloat((ciUpper * 1000).toFixed(1)),
    });
  }

  return (
    <div className="animate-in space-y-6">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          Tyre Intelligence
          <DataLabel type="ESTIMATED" />
        </h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          Estimated tyre-induced pace loss extracted from the Linear Mixed-Effects model
        </p>
      </div>

      <WhyItMatters>
        Raw lap time combines multiple effects like fuel burn and track evolution. This curve isolates the tyre-associated component, revealing how much pace is lost purely due to the tyre over a stint.
      </WhyItMatters>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="Estimated Pace Loss Rate"
          value={(data.estimated_tyre_pace_loss_rate * 1000).toFixed(1)}
          unit="ms/lap"
          status={<StatusBadge status={data.model_status} />}
        />
        <MetricCard
          label="Standard Error"
          value={(data.tyre_slope_se * 1000).toFixed(1)}
          unit="ms/lap"
        />
        <MetricCard
          label="95% CI"
          value={`[${(data.tyre_slope_ci_lower * 1000).toFixed(0)}, ${(data.tyre_slope_ci_upper * 1000).toFixed(0)}]`}
          unit="ms/lap"
        />
        <MetricCard
          label="p-value"
          value={data.tyre_slope_p_value < 0.001 ? '< 0.001' : data.tyre_slope_p_value.toFixed(4)}
          sublabel={data.tyre_slope_p_value < 0.05 ? 'Statistically significant' : 'Not significant'}
        />
      </div>

      {/* Degradation Curve */}
      <ChartPanel
        title="Estimated Tyre-Induced Pace Loss Curve"
        subtitle="Population-level estimate with 95% confidence band. This is NOT 'true tyre wear' — it is the estimated tyre contribution to lap time."
      >
        <ResponsiveContainer width="100%" height={360}>
          <ComposedChart data={curveData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="tyreLife"
              label={{ value: 'Tyre Life (laps)', position: 'insideBottom', offset: -5 }}
            />
            <YAxis
              label={{ value: 'Estimated Pace Loss (ms)', angle: -90, position: 'insideLeft', offset: 10 }}
            />
            <Tooltip
              formatter={(val, name) => {
                const labels = {
                  estimated: 'Estimated',
                  ciLower: 'CI Lower',
                  ciUpper: 'CI Upper',
                };
                return [`${val} ms`, labels[name] || name];
              }}
            />
            <Legend />
            <Area
              type="monotone"
              dataKey="ciUpper"
              stroke="none"
              fill="var(--chart-fill-1)"
              fillOpacity={1}
              name="95% CI Upper"
            />
            <Area
              type="monotone"
              dataKey="ciLower"
              stroke="none"
              fill="var(--bg-deep)"
              fillOpacity={1}
              name="95% CI Lower"
            />
            <Line
              type="monotone"
              dataKey="estimated"
              stroke="var(--chart-line-1)"
              strokeWidth={2.5}
              dot={false}
              name="Estimated Pace Loss"
            />
            <ReferenceLine y={0} stroke="var(--text-muted)" strokeDasharray="3 3" />
          </ComposedChart>
        </ResponsiveContainer>
        <p className="text-xs text-center text-[var(--text-secondary)] mt-4 italic">
          Interpretation: The solid blue line is the estimated pace lost to the tyre per lap. The shaded region shows the model's 95% uncertainty interval.
        </p>
      </ChartPanel>

      {/* Data Context */}
      <div className="glass-panel p-5">
        <h3 className="text-sm font-semibold mb-3">Model Context</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
          <div>
            <span className="text-[var(--text-muted)]">Compound</span>
            <div className="font-mono mt-0.5">{data.compound} <DataLabel type="OBSERVED" /></div>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Drivers</span>
            <div className="font-mono mt-0.5">{data.driver_count} <DataLabel type="OBSERVED" /></div>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Stints</span>
            <div className="font-mono mt-0.5">{data.stint_count}</div>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Valid Laps</span>
            <div className="font-mono mt-0.5">{data.lap_count}</div>
          </div>
          <div>
            <span className="text-[var(--text-muted)]">Fuel Prior</span>
            <div className="font-mono mt-0.5">{data.fuel_prior} s/lap <DataLabel type="ASSUMED" /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
