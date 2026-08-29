import { useState, useEffect } from 'react';
import { api } from '../../api';
import { DataLabel } from '../../components/StatusBadge';
import { ChartPanel, MetricCard, LoadingState, ErrorState, EmptyState } from '../../components/ChartPanel';
import { WhyItMatters } from '../../components/StoryElements';
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';

export default function CompareMode({ sessionId, baseDriverId, drivers }) {
  const [compareDriverId, setCompareDriverId] = useState('');
  
  // Auto-select compare driver
  useEffect(() => {
    if (!compareDriverId && drivers && drivers.length > 0) {
      const other = drivers.find(d => d !== baseDriverId) || drivers[0];
      if (other && other !== baseDriverId) {
        setCompareDriverId(other);
      }
    }
  }, [drivers, baseDriverId, compareDriverId]);

  const [baseData, setBaseData] = useState(null);
  const [compareData, setCompareData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId || !baseDriverId || !compareDriverId) return;
    
    setLoading(true);
    setError(null);
    
    Promise.all([
      api.getGhostBaseline(sessionId, baseDriverId),
      api.getGhostBaseline(sessionId, compareDriverId)
    ])
    .then(([baseRes, compRes]) => {
      setBaseData(baseRes);
      setCompareData(compRes);
    })
    .catch(e => setError(e.message))
    .finally(() => setLoading(false));
  }, [sessionId, baseDriverId, compareDriverId]);

  if (!baseDriverId) return <EmptyState message="Select a base driver in the workspace header first." />;

  // Build combined chart data
  const combinedData = [];
  if (baseData && compareData) {
    const maxLaps = Math.max(baseData.laps.length, compareData.laps.length);
    for (let i = 0; i < maxLaps; i++) {
      const bLap = baseData.laps[i];
      const cLap = compareData.laps[i];
      if (bLap || cLap) {
        combinedData.push({
          lap: bLap?.lap_number || cLap?.lap_number,
          baseTime: bLap ? parseFloat(bLap.observed_lap_time.toFixed(3)) : null,
          compTime: cLap ? parseFloat(cLap.observed_lap_time.toFixed(3)) : null,
          baseGhost: bLap ? parseFloat(bLap.ghost_baseline.toFixed(3)) : null,
          compGhost: cLap ? parseFloat(cLap.ghost_baseline.toFixed(3)) : null,
        });
      }
    }
  }

  // Generate Insight
  let insight = null;
  if (baseData && compareData) {
    const baseSlope = baseData.tyre_slope * 1000;
    const compSlope = compareData.tyre_slope * 1000;
    const diff = baseSlope - compSlope;
    
    let txt = '';
    if (Math.abs(diff) < 10) {
      txt = `Both ${baseDriverId} and ${compareDriverId} show nearly identical estimated tyre-induced pace loss (difference < 10 ms/lap).`;
    } else if (diff > 0) {
      txt = `${baseDriverId} shows a stronger estimated tyre degradation slope than ${compareDriverId} by ${diff.toFixed(1)} ms/lap.`;
    } else {
      txt = `${compareDriverId} shows a stronger estimated tyre degradation slope than ${baseDriverId} by ${Math.abs(diff).toFixed(1)} ms/lap.`;
    }
    
    insight = txt;
  }

  return (
    <div className="animate-in space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-[var(--border-muted)] pb-4">
        <div>
          <h2 className="text-lg font-bold">Compare Drivers</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Compare Ghost Baseline and tyre slope estimates directly.
          </p>
        </div>
        <div className="flex items-center gap-4 bg-[var(--bg-elevated)] p-2 rounded-lg border border-[var(--border-default)]">
          <span className="font-bold text-[var(--accent-blue)]">{baseDriverId}</span>
          <span className="text-[var(--text-muted)] text-sm italic">vs</span>
          <select
            className="ghost-select text-xs"
            value={compareDriverId}
            onChange={e => setCompareDriverId(e.target.value)}
          >
            <option value="" disabled>Select Driver to Compare</option>
            {drivers.filter(d => d !== baseDriverId).map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
      </div>

      {!compareDriverId && (
        <EmptyState message="Select a driver to compare against." />
      )}

      {loading && <LoadingState message="Loading comparison data..." />}
      {error && <ErrorState message={error} />}

      {baseData && compareData && !loading && (
        <>
          {/* AI Insight Box */}
          <div className="glass-panel p-5 bg-gradient-to-r from-[var(--bg-elevated)] to-[var(--bg-deep)] border-l-4 border-[var(--status-go)]">
            <h3 className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest mb-2">Model Insight</h3>
            <p className="text-sm text-[var(--text-primary)] font-bold">{insight}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Base Driver Stats */}
            <div className="glass-panel p-5 border border-[var(--accent-blue)]">
              <h3 className="text-lg font-bold text-[var(--accent-blue)] mb-4">{baseDriverId}</h3>
              <div className="space-y-4">
                <MetricCard
                  label="Ghost Baseline"
                  value={baseData.ghost_baseline_value.toFixed(3)}
                  unit="s"
                  status={<DataLabel type="ESTIMATED" />}
                />
                <MetricCard
                  label="Tyre Slope"
                  value={(baseData.tyre_slope * 1000).toFixed(1)}
                  unit="ms/lap"
                  status={<DataLabel type="ESTIMATED" />}
                />
              </div>
            </div>

            {/* Compare Driver Stats */}
            <div className="glass-panel p-5 border border-[var(--accent-purple)]">
              <h3 className="text-lg font-bold text-[var(--accent-purple)] mb-4">{compareDriverId}</h3>
              <div className="space-y-4">
                <MetricCard
                  label="Ghost Baseline"
                  value={compareData.ghost_baseline_value.toFixed(3)}
                  unit="s"
                  status={<DataLabel type="ESTIMATED" />}
                />
                <MetricCard
                  label="Tyre Slope"
                  value={(compareData.tyre_slope * 1000).toFixed(1)}
                  unit="ms/lap"
                  status={<DataLabel type="ESTIMATED" />}
                />
              </div>
            </div>
          </div>

          <ChartPanel
            title="Lap Time Comparison"
            subtitle="Observed lap times vs Estimated Ghost Baselines"
          >
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={combinedData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="lap" label={{ value: 'Lap Number', position: 'insideBottom', offset: -5 }} />
                <YAxis domain={['auto', 'auto']} label={{ value: 'Lap Time (s)', angle: -90, position: 'insideLeft', offset: 10 }} />
                <Tooltip formatter={(val, name) => [`${val} s`, name]} labelFormatter={l => `Lap ${l}`} />
                <Legend />
                
                {/* Base Driver */}
                <ReferenceLine y={baseData.ghost_baseline_value} stroke="var(--accent-blue)" strokeDasharray="8 4" opacity={0.5} />
                <Line
                  type="monotone"
                  dataKey="baseTime"
                  stroke="var(--accent-blue)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--accent-blue)' }}
                  name={`${baseDriverId} Observed`}
                />
                
                {/* Compare Driver */}
                <ReferenceLine y={compareData.ghost_baseline_value} stroke="var(--accent-purple)" strokeDasharray="8 4" opacity={0.5} />
                <Line
                  type="monotone"
                  dataKey="compTime"
                  stroke="var(--accent-purple)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: 'var(--accent-purple)' }}
                  name={`${compareDriverId} Observed`}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartPanel>
        </>
      )}
    </div>
  );
}
