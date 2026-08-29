import { useState, useEffect } from 'react';
import { api } from '../api';
import { DataLabel } from '../components/StatusBadge';
import { ChartPanel, MetricCard, LoadingState, ErrorState, EmptyState } from '../components/ChartPanel';
import { WhyItMatters } from '../components/StoryElements';
import {
  ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

export default function GhostBaseline({ sessionId, driverId, onDriverSelect }) {
  const [data, setData] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showMath, setShowMath] = useState(false);

  // Load driver list
  useEffect(() => {
    if (!sessionId) return;
    api.getSessionStats(sessionId)
      .then(s => setDrivers(s.drivers))
      .catch(() => {});
  }, [sessionId]);

  // Load ghost baseline
  useEffect(() => {
    if (!sessionId || !driverId) return;
    setLoading(true);
    setError(null);
    api.getGhostBaseline(sessionId, driverId)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId, driverId]);

  if (!sessionId) return <EmptyState message="Select a session first" />;

  // Build chart data
  const chartData = data?.laps?.map(l => ({
    lap: l.lap_number,
    observed: parseFloat(l.observed_lap_time.toFixed(3)),
    baseline: parseFloat(l.ghost_baseline.toFixed(3)),
    withTyre: parseFloat((l.ghost_baseline + l.estimated_tyre_contribution + l.estimated_session_contribution).toFixed(3)),
    withFuel: parseFloat(l.attributed_total.toFixed(3)),
    residual: parseFloat(l.residual.toFixed(3)),
    tyreContrib: parseFloat((l.estimated_tyre_contribution * 1000).toFixed(1)),
    fuelAssump: parseFloat((l.fuel_assumption * 1000).toFixed(1)),
  })) || [];

  return (
    <div className="animate-in space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            Ghost Baseline
            <DataLabel type="ESTIMATED" />
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Pace attribution: observed = baseline + tyre contribution + fuel assumption + residual
          </p>
        </div>
        <select
          className="ghost-select"
          value={driverId || ''}
          onChange={e => onDriverSelect(e.target.value)}
        >
          <option value="" disabled>Select Driver</option>
          {drivers.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {loading && <LoadingState message={`Computing ghost baseline for ${driverId}...`} />}
      {error && <ErrorState message={error} />}

      {data && !loading && (
        <>
          <WhyItMatters>
            A flat raw lap time does not mean the tyre isn't losing performance—it usually means fuel-burn pace gains are perfectly masking the tyre pace loss. The Ghost Baseline isolates the tyre's effect.
          </WhyItMatters>

          {/* High-Level Metrics (Judge View) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Driver Baseline"
              value={data.ghost_baseline_value.toFixed(2)}
              unit="s"
              sublabel="Estimated base pace"
              status={<DataLabel type="ESTIMATED" />}
            />
            <MetricCard
              label="Tyre Contribution"
              value={`+${(data.tyre_slope * 1000).toFixed(0)}`}
              unit="ms/lap"
              sublabel="Pace loss rate"
              status={<DataLabel type="ESTIMATED" />}
            />
            <MetricCard
              label="Fuel Assumption"
              value={(data.fuel_prior * -1000).toFixed(0)}
              unit="ms/lap"
              sublabel="Assumed pace gain"
              status={<DataLabel type="ASSUMED" />}
            />
            <MetricCard
              label="Uncertainty"
              value={`±${(data.tyre_slope_se * 1960).toFixed(0)}`}
              unit="ms/lap"
              sublabel="95% confidence interval"
            />
          </div>

          {/* Progressive Disclosure Toggle */}
          <div className="flex justify-end">
            <button 
              onClick={() => setShowMath(!showMath)}
              className="text-xs text-[var(--accent-blue)] hover:underline flex items-center gap-1 font-mono"
            >
              {showMath ? '▼ Hide mathematical details' : '▶ Show mathematical details'}
            </button>
          </div>

          {/* Mathematical Details (Hidden by default) */}
          {showMath && (
            <div className="glass-panel p-5 animate-in bg-[var(--bg-hover)] border-dashed border-[var(--border-muted)]">
              <h3 className="text-xs font-semibold mb-3 text-[var(--text-secondary)] uppercase tracking-wider">
                Linear Mixed-Effects Coefficients
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                <div>
                  <span className="text-[var(--text-muted)] block mb-1">Driver Random Effect</span>
                  <span className="text-[var(--text-primary)]">{(data.driver_random_effect * 1000).toFixed(1)} ms</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block mb-1">Tyre Slope SE</span>
                  <span className="text-[var(--text-primary)]">{(data.tyre_slope_se * 1000).toFixed(1)} ms/lap</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block mb-1">Fuel Prior (λ)</span>
                  <span className="text-[var(--text-primary)]">{data.fuel_prior} s/lap</span>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] block mb-1">LME Group</span>
                  <span className="text-[var(--text-primary)]">{data.driver}</span>
                </div>
              </div>
            </div>
          )}

          {/* Main Attribution Chart */}
          <ChartPanel
            title={`Pace Attribution — ${driverId}`}
            subtitle="The gap between the observed lap time and the Ghost Baseline reveals the true tyre and fuel effects."
          >
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="lap" label={{ value: 'Lap Number', position: 'insideBottom', offset: -5 }} />
                <YAxis domain={['auto', 'auto']} label={{ value: 'Lap Time (s)', angle: -90, position: 'insideLeft', offset: 10 }} />
                <Tooltip
                  formatter={(val, name) => [`${val} s`, name]}
                  labelFormatter={l => `Lap ${l}`}
                />
                <Legend />
                <ReferenceLine
                  y={data.ghost_baseline_value}
                  stroke="var(--status-nogo)"
                  strokeDasharray="8 4"
                  label={{ value: 'Ghost Baseline', fill: 'var(--status-nogo)', fontSize: 10 }}
                />
                <Line
                  type="monotone"
                  dataKey="observed"
                  stroke="var(--text-primary)"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: 'var(--text-primary)' }}
                  name="Observed Lap Time"
                />
                <Line
                  type="monotone"
                  dataKey="withFuel"
                  stroke="var(--chart-line-1)"
                  strokeWidth={1.5}
                  strokeDasharray="5 3"
                  dot={false}
                  name="Model Attributed Total"
                />
              </ComposedChart>
            </ResponsiveContainer>
            <p className="text-xs text-center text-[var(--text-secondary)] mt-4 italic">
              Interpretation: If the observed line (white) stays flat while the baseline (red) drops, the tyre is losing performance despite the consistent lap times.
            </p>
          </ChartPanel>

          {/* Component Breakdown Chart */}
          <ChartPanel
            title="Component Breakdown"
            subtitle="Estimated tyre contribution vs assumed fuel gain (ms)"
          >
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="lap" />
                <YAxis label={{ value: 'ms', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(val, name) => [`${val} ms`, name]} />
                <Legend />
                <Bar dataKey="tyreContrib" fill="var(--status-nogo)" opacity={0.7} name="Tyre Penalty (Estimated)" />
                <Bar dataKey="fuelAssump" fill="var(--chart-line-4)" opacity={0.7} name="Fuel Gain (Assumed)" />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartPanel>

          {/* Lap Table */}
          <div className="glass-panel p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold mb-3">Lap-by-Lap Attribution</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lap</th>
                  <th>Tyre Life</th>
                  <th>Observed <DataLabel type="OBSERVED" /></th>
                  <th>Baseline <DataLabel type="ESTIMATED" /></th>
                  <th>Tyre <DataLabel type="ESTIMATED" /></th>
                  <th>Fuel <DataLabel type="ASSUMED" /></th>
                  <th>Residual</th>
                </tr>
              </thead>
              <tbody>
                {data.laps.map(l => (
                  <tr key={l.lap_number}>
                    <td>{l.lap_number}</td>
                    <td>{l.tyre_life}</td>
                    <td>{l.observed_lap_time.toFixed(3)}</td>
                    <td>{l.ghost_baseline.toFixed(3)}</td>
                    <td className="text-[var(--status-nogo)]">+{(l.estimated_tyre_contribution * 1000).toFixed(0)}ms</td>
                    <td className="text-[var(--chart-line-4)]">{(l.fuel_assumption * 1000).toFixed(0)}ms</td>
                    <td className={l.residual > 0 ? 'text-[var(--accent-orange)]' : 'text-[var(--accent-cyan)]'}>
                      {(l.residual * 1000).toFixed(0)}ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
