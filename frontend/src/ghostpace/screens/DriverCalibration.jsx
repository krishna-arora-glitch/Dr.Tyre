import { useState, useEffect } from 'react';
import { api } from '../api';
import { DataLabel } from '../components/StatusBadge';
import { ChartPanel, MetricCard, LoadingState, ErrorState, EmptyState } from '../components/ChartPanel';
import { WhyItMatters } from '../components/StoryElements';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceDot,
} from 'recharts';

const K_VALUES = [0, 1, 2, 3, 5];

export default function DriverCalibration({ sessionId, driverId, onDriverSelect }) {
  const [k, setK] = useState(2);
  const [data, setData] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId) return;
    api.getSessionStats(sessionId)
      .then(s => setDrivers(s.drivers))
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !driverId) return;
    setLoading(true);
    setError(null);
    api.getCalibration(sessionId, driverId, k)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sessionId, driverId, k]);

  if (!sessionId) return <EmptyState message="Select a session first" />;

  const chartData = data?.laps?.map(l => ({
    lap: l.lap_number,
    observed: parseFloat(l.observed_lap_time.toFixed(3)),
    predicted: parseFloat(l.predicted_lap_time.toFixed(3)),
    isCalib: l.is_calibration_lap,
  })) || [];

  return (
    <div className="animate-in space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            Driver Calibration
            <DataLabel type="ESTIMATED" />
          </h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Few-shot baseline calibration — observe K laps then project the remaining trajectory.
            {k === 1 && (
              <span className="text-[var(--status-caution)] ml-1">
                ⚠ K=1 is highly sensitive to first-lap effects
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-3">
          <select
            className="ghost-select"
            value={driverId || ''}
            onChange={e => onDriverSelect(e.target.value)}
          >
            <option value="" disabled>Select Driver</option>
            {drivers.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select
            className="ghost-select"
            value={k}
            onChange={e => setK(Number(e.target.value))}
          >
            {K_VALUES.map(v => (
              <option key={v} value={v}>K = {v} laps</option>
            ))}
          </select>
        </div>
      </div>

      <WhyItMatters>
        Different cars have different baseline pace. We calibrate the baseline by observing a few early laps before projecting the tyre behaviour. This proves the tyre physics model transfers to unseen drivers.
      </WhyItMatters>

      {loading && <LoadingState message={`Calibrating ${driverId} with K=${k}...`} />}
      {error && <ErrorState message={error} />}

      {data && !loading && (
        <>
          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MetricCard
              label="Calibration Laps"
              value={data.calibration_laps}
              sublabel={`of ${data.total_laps} total`}
            />
            <MetricCard
              label="Driver Offset"
              value={(data.driver_offset * 1000).toFixed(1)}
              unit="ms"
              status={<DataLabel type="ESTIMATED" />}
            />
            <MetricCard
              label="Trajectory RMSE"
              value={isNaN(data.trajectory_rmse) ? '—' : data.trajectory_rmse.toFixed(3)}
              unit="s"
              sublabel="On remaining laps"
            />
            <MetricCard
              label="Trajectory MAE"
              value={isNaN(data.trajectory_mae) ? '—' : data.trajectory_mae.toFixed(3)}
              unit="s"
              sublabel="On remaining laps"
            />
            <MetricCard
              label="Remaining Laps"
              value={data.remaining_laps}
              sublabel="Out-of-sample evaluation"
            />
          </div>

          {/* Trajectory Chart */}
          <ChartPanel
            title={`Predicted vs Observed Trajectory — ${driverId}`}
            subtitle={`First ${k} laps used for calibration (highlighted). Remaining trajectory is out-of-sample prediction.`}
          >
            <ResponsiveContainer width="100%" height={380}>
              <LineChart data={chartData} margin={{ top: 10, right: 30, left: 20, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="lap"
                  label={{ value: 'Lap Number', position: 'insideBottom', offset: -5 }}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  label={{ value: 'Lap Time (s)', angle: -90, position: 'insideLeft', offset: 10 }}
                />
                <Tooltip
                  formatter={(val, name) => [`${val} s`, name]}
                  labelFormatter={l => `Lap ${l}`}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="observed"
                  stroke="var(--text-primary)"
                  strokeWidth={2}
                  dot={(props) => {
                    const { cx, cy, payload } = props;
                    if (payload.isCalib) {
                      return (
                        <circle
                          cx={cx} cy={cy} r={6}
                          fill="var(--accent-blue)"
                          stroke="var(--accent-blue)"
                          strokeWidth={2}
                          opacity={0.8}
                        />
                      );
                    }
                    return <circle cx={cx} cy={cy} r={3} fill="var(--text-primary)" />;
                  }}
                  name="Observed"
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="var(--accent-purple)"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                  dot={{ r: 2, fill: 'var(--accent-purple)' }}
                  name="Predicted (Calibrated)"
                />
              </LineChart>
            </ResponsiveContainer>
            <p className="text-xs text-center text-[var(--text-secondary)] mt-4 italic">
              Interpretation: The model learns the driver's starting pace from the highlighted dots, then projects the dotted line. A close fit on the remaining laps means the global tyre model generalized correctly.
            </p>
          </ChartPanel>

          {/* Lap Table */}
          <div className="glass-panel p-5 overflow-x-auto">
            <h3 className="text-sm font-semibold mb-3">Lap Detail</h3>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Lap</th>
                  <th>Tyre Life</th>
                  <th>Role</th>
                  <th>Observed <DataLabel type="OBSERVED" /></th>
                  <th>Predicted <DataLabel type="ESTIMATED" /></th>
                  <th>Residual</th>
                </tr>
              </thead>
              <tbody>
                {data.laps.map(l => (
                  <tr key={l.lap_number} className={l.is_calibration_lap ? 'calibration-highlight' : ''}>
                    <td>{l.lap_number}</td>
                    <td>{l.tyre_life}</td>
                    <td>
                      {l.is_calibration_lap
                        ? <span className="text-[var(--accent-blue)] font-semibold text-xs">CALIBRATION</span>
                        : <span className="text-[var(--text-muted)] text-xs">EVALUATION</span>
                      }
                    </td>
                    <td>{l.observed_lap_time.toFixed(3)}</td>
                    <td>{l.predicted_lap_time.toFixed(3)}</td>
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
