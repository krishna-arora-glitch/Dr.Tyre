import { useState, useEffect } from 'react';
import { api } from '../../api';
import { DataLabel, StatusBadge } from '../../components/StatusBadge';
import { LoadingState, ErrorState, EmptyState } from '../../components/ChartPanel';

const QUESTIONS = [
  { id: 'q1', label: 'Is tyre degradation significant?' },
  { id: 'q2', label: 'Why did pace change?' },
  { id: 'q3', label: 'How uncertain is the estimate?' },
];

export default function InvestigateMode({ sessionId, driverId }) {
  const [activeQ, setActiveQ] = useState('q1');
  
  const [intelData, setIntelData] = useState(null);
  const [ghostData, setGhostData] = useState(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!sessionId || !driverId || !activeQ) return;
    
    setLoading(true);
    setError(null);
    
    Promise.all([
      api.getIntelligence(sessionId),
      api.getGhostBaseline(sessionId, driverId)
    ])
    .then(([intel, ghost]) => {
      setIntelData(intel);
      setGhostData(ghost);
    })
    .catch(e => setError(e.message))
    .finally(() => setLoading(false));
  }, [sessionId, driverId, activeQ]);

  if (!driverId) return <EmptyState message="Select a context driver in the workspace header first." />;

  const renderAnswer = () => {
    if (loading) return <LoadingState message="Investigating..." />;
    if (error) return <ErrorState message={error} />;
    if (!intelData || !ghostData) return null;

    if (activeQ === 'q1') {
      const slope = (intelData.estimated_tyre_pace_loss_rate || 0) * 1000;
      const pval = intelData.tyre_slope_p_value !== undefined ? intelData.tyre_slope_p_value : 0;
      const isSig = intelData.model_status === 'GO';
      
      return (
        <div className="animate-in slide-in-from-bottom-4">
          <h3 className="text-xl font-bold mb-4 text-[var(--accent-cyan)]">Is tyre degradation significant?</h3>
          
          <div className="glass-panel p-6 mb-6">
            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3">Evidence</h4>
            <ul className="space-y-2 text-sm">
              <li>Estimated tyre slope: <strong className="text-[var(--text-primary)]">{slope.toFixed(1)} ms/lap</strong></li>
              <li>Statistical significance (p-value): <strong className="text-[var(--text-primary)]">{pval < 0.001 ? '< 0.001' : pval.toFixed(4)}</strong></li>
              <li>Model Status: <StatusBadge status={intelData.model_status} /></li>
            </ul>
          </div>
          
          <div className="glass-panel p-6 bg-gradient-to-r from-[var(--bg-elevated)] to-[var(--bg-deep)] border-l-4 border-[var(--status-go)]">
            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-2">Conclusion</h4>
            <p className="text-sm">
              {isSig 
                ? `Yes. The model detected a statistically significant tyre-induced pace loss of ${slope.toFixed(1)} ms/lap for the session.`
                : `No strong conclusion can be drawn. The degradation signal is too weak or noisy (Status: ${intelData.model_status}).`}
            </p>
          </div>
        </div>
      );
    }
    
    if (activeQ === 'q2') {
      const laps = ghostData?.laps || [];
      if (laps.length === 0) {
        return <EmptyState message="No lap data available for pace change analysis." />;
      }
      
      // Calculate pace change from first to last lap
      const firstLap = laps[0];
      const lastLap = laps[laps.length - 1];
      
      const totalPaceChange = (lastLap.observed_lap_time - firstLap.observed_lap_time) * 1000;
      const tyreContrib = (lastLap.estimated_tyre_contribution - firstLap.estimated_tyre_contribution) * 1000;
      const fuelContrib = (lastLap.fuel_assumption - firstLap.fuel_assumption) * 1000;
      const residual = (lastLap.residual - firstLap.residual) * 1000;
      
      return (
        <div className="animate-in slide-in-from-bottom-4">
          <h3 className="text-xl font-bold mb-4 text-[var(--accent-cyan)]">Why did pace change?</h3>
          
          <div className="glass-panel p-6 mb-6">
            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3">Evidence (First to Last Lap)</h4>
            <ul className="space-y-2 text-sm font-mono">
              <li>Observed pace change: <strong className="text-[var(--text-primary)]">{(totalPaceChange > 0 ? '+' : '')}{totalPaceChange.toFixed(0)} ms</strong> <DataLabel type="OBSERVED" /></li>
              <li className="mt-4 text-[var(--text-secondary)]">Decomposed into:</li>
              <li className="text-[var(--status-nogo)]">Tyre contribution: +{tyreContrib.toFixed(0)} ms <DataLabel type="ESTIMATED" /></li>
              <li className="text-[var(--chart-line-4)]">Fuel contribution: {fuelContrib.toFixed(0)} ms <DataLabel type="ASSUMED" /></li>
              <li>Unexplained residual: {(residual > 0 ? '+' : '')}{residual.toFixed(0)} ms</li>
            </ul>
          </div>
          
          <div className="glass-panel p-6 bg-gradient-to-r from-[var(--bg-elevated)] to-[var(--bg-deep)] border-l-4 border-[var(--accent-blue)]">
            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-2">Conclusion</h4>
            <p className="text-sm">
              The observed pace change is primarily driven by a {tyreContrib.toFixed(0)}ms tyre penalty offset by a {Math.abs(fuelContrib).toFixed(0)}ms fuel gain. 
              {Math.abs(residual) > Math.abs(tyreContrib) ? " However, substantial unexplained variation remains." : " The tyre degradation model explains most of the underlying pace shift."}
            </p>
          </div>
        </div>
      );
    }
    
    if (activeQ === 'q3') {
      const se = (intelData.tyre_slope_se || 0) * 1000;
      const ciHalf = se * 1.96;
      const slopeMs = (intelData.estimated_tyre_pace_loss_rate || 0.001) * 1000;
      const cv = slopeMs !== 0 ? (se / slopeMs) * 100 : 0;
      
      return (
        <div className="animate-in slide-in-from-bottom-4">
          <h3 className="text-xl font-bold mb-4 text-[var(--accent-cyan)]">How uncertain is the estimate?</h3>
          
          <div className="glass-panel p-6 mb-6">
            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-3">Evidence</h4>
            <ul className="space-y-2 text-sm">
              <li>Standard Error: <strong className="text-[var(--text-primary)]">{se.toFixed(1)} ms/lap</strong></li>
              <li>95% Confidence Interval width: <strong className="text-[var(--text-primary)]">±{ciHalf.toFixed(1)} ms/lap</strong></li>
              <li>Coefficient of Variation: <strong className="text-[var(--text-primary)]">{cv.toFixed(1)}%</strong></li>
            </ul>
          </div>
          
          <div className="glass-panel p-6 bg-gradient-to-r from-[var(--bg-elevated)] to-[var(--bg-deep)] border-l-4 border-[var(--status-caution)]">
            <h4 className="text-xs font-bold text-[var(--text-muted)] uppercase mb-2">Conclusion</h4>
            <p className="text-sm">
              {cv < 30 
                ? "The estimate has low uncertainty relative to its magnitude, indicating a stable model fit." 
                : "The estimate has high uncertainty. Consider checking for outliers or reviewing the fuel sensitivity."}
            </p>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col md:flex-row gap-8 animate-in h-full">
      {/* Sidebar: Questions */}
      <div className="w-full md:w-1/3 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)] mb-4">Investigate</h2>
        {QUESTIONS.map(q => (
          <button
            key={q.id}
            onClick={() => setActiveQ(q.id)}
            className={`w-full text-left p-4 rounded-lg border transition-all text-sm font-bold
              ${activeQ === q.id 
                ? 'bg-[var(--accent-blue)] border-[var(--accent-cyan)] text-white shadow-[0_0_15px_rgba(88,166,255,0.3)]' 
                : 'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
              }`}
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* Main Content: Answers */}
      <div className="w-full md:w-2/3">
        {!activeQ ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-12 border-dashed border-2 border-[var(--border-muted)] rounded-xl opacity-50">
            <span className="text-4xl mb-4">🕵️</span>
            <p className="text-[var(--text-secondary)]">Select a question to investigate using the LME model data.</p>
          </div>
        ) : (
          renderAnswer()
        )}
      </div>
    </div>
  );
}
