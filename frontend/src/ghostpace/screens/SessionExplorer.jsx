import { useState, useEffect } from 'react';
import { api } from '../api';
import { StatusBadge, DataLabel } from '../components/StatusBadge';
import { MetricCard, LoadingState, ErrorState } from '../components/ChartPanel';

export default function SessionExplorer({ sessionId, onSessionChange, onDriverSelect }) {
  const [sessions, setSessions] = useState([]);
  const [stats, setStats] = useState(null);
  const [intelligence, setIntelligence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getSessions()
      .then(d => setSessions(d.sessions))
      .catch(e => setError(e.message));
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getSessionStats(sessionId),
      api.getIntelligence(sessionId),
    ])
      .then(([s, i]) => { setStats(s); setIntelligence(i); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId]);

  return (
    <div className="animate-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            Session Explorer
            <DataLabel type="OBSERVED" />
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Select a session to analyze tyre-induced pace loss from practice data
          </p>
        </div>

        <select
          className="ghost-select"
          value={sessionId || ''}
          onChange={e => onSessionChange(e.target.value)}
        >
          <option value="" disabled>Select Session</option>
          {sessions.map(s => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
      </div>

      {error && <ErrorState message={error} onRetry={() => { setError(null); setLoading(true); }} />}
      {loading && !error && <LoadingState message="Loading session data..." />}

      {stats && intelligence && !loading && (
        <>
          {/* Metric Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <MetricCard label="Drivers" value={stats.driver_count} />
            <MetricCard label="Stints" value={stats.stint_count} />
            <MetricCard label="Valid Laps" value={stats.lap_count} />
            <MetricCard label="Compound" value={stats.compound} />
            <MetricCard
              label="Outliers Removed"
              value={stats.outlier_laps_removed}
              sublabel={`of ${stats.valid_laps_pre_stint} valid`}
            />
            <MetricCard
              label="Model Status"
              value=""
              status={<StatusBadge status={intelligence.model_status} />}
            />
          </div>

          {/* Intelligence Summary */}
          <div className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              Tyre Intelligence Summary
              <DataLabel type="ESTIMATED" />
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MetricCard
                label="Estimated Tyre-Induced Pace Loss Rate"
                value={(intelligence.estimated_tyre_pace_loss_rate * 1000).toFixed(1)}
                unit="ms/lap"
                sublabel={`± ${(intelligence.tyre_slope_se * 1000).toFixed(1)} ms/lap SE`}
              />
              <MetricCard
                label="95% Confidence Interval"
                value={`[${(intelligence.tyre_slope_ci_lower * 1000).toFixed(1)}, ${(intelligence.tyre_slope_ci_upper * 1000).toFixed(1)}]`}
                unit="ms/lap"
                sublabel={`p = ${intelligence.tyre_slope_p_value.toExponential(2)}`}
              />
              <MetricCard
                label="Fuel Prior"
                value={intelligence.fuel_prior}
                unit="s/lap"
                sublabel="ASSUMED — not observed"
                status={<DataLabel type="ASSUMED" />}
              />
            </div>
          </div>

          {/* Driver List */}
          <div className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-3">Available Drivers</h3>
            <div className="flex flex-wrap gap-2">
              {stats.drivers.map(d => (
                <button
                  key={d}
                  onClick={() => onDriverSelect(d)}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono font-medium
                    bg-[var(--bg-elevated)] border border-[var(--border-default)]
                    text-[var(--text-primary)] hover:border-[var(--accent-blue)]
                    hover:bg-[var(--bg-hover)] transition-all cursor-pointer"
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          {/* Tyre Age Range */}
          <div className="glass-panel p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              Data Summary
              <DataLabel type="OBSERVED" />
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-[var(--text-muted)]">Session</span>
                <div className="font-mono mt-0.5">{stats.label}</div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Tyre Age Range</span>
                <div className="font-mono mt-0.5">
                  {intelligence.tyre_age_range[0]} – {intelligence.tyre_age_range[1]} laps
                </div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Raw Laps (Pre-Filter)</span>
                <div className="font-mono mt-0.5">{stats.total_laps_raw}</div>
              </div>
              <div>
                <span className="text-[var(--text-muted)]">Session Time Effect</span>
                <div className="font-mono mt-0.5">
                  {(intelligence.session_time_effect * 1000).toFixed(3)} ms/s
                  <DataLabel type="ESTIMATED" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
