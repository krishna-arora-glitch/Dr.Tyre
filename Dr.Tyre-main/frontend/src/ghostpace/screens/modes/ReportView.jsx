import { useState, useEffect } from 'react';
import { api } from '../../api';
import { LoadingState, ErrorState } from '../../components/ChartPanel';
import { StatusBadge } from '../../components/StatusBadge';

export default function ReportView({ project, driverId }) {
  const [intelData, setIntelData] = useState(null);
  const [ghostData, setGhostData] = useState(null);
  const [oracleData, setOracleData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!project.session) return;
    setLoading(true);
    
    // Attempt to load all relevant data for the report
    const promises = [api.getIntelligence(project.session)];
    if (driverId) promises.push(api.getGhostBaseline(project.session, driverId));
    
    // Guess track from session name for oracle validation (simple heuristic for demo)
    const track = project.session.includes('bahrain') ? 'Bahrain' : project.session.includes('spain') ? 'Spain' : null;
    if (track) promises.push(api.getOracleValidation(track));

    Promise.allSettled(promises)
      .then((results) => {
        if (results[0].status === 'fulfilled') setIntelData(results[0].value);
        if (results[1] && results[1].status === 'fulfilled') setGhostData(results[1].value);
        if (results[2] && results[2].status === 'fulfilled') setOracleData(results[2].value);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [project.session, driverId]);

  if (loading) return <LoadingState message="Compiling engineering report..." />;
  if (error) return <ErrorState message={error} />;
  if (!intelData) return <div className="p-8 text-center text-[var(--text-muted)]">No data available for report.</div>;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-[800px] mx-auto bg-white text-black p-10 rounded shadow-lg printable-report animate-in">
      
      {/* Non-printable action bar */}
      <div className="flex justify-between items-center mb-8 print:hidden border-b border-gray-200 pb-4">
        <h2 className="text-xl font-bold text-gray-800">Report Preview</h2>
        <button 
          onClick={handlePrint}
          className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm font-bold transition-colors print:hidden flex items-center gap-2"
        >
          <span>🖨️</span> Print / Save PDF
        </button>
      </div>

      {/* Report Header */}
      <div className="border-b-4 border-black pb-4 mb-8">
        <div className="flex justify-between items-end">
          <div>
            <h1 className="text-4xl font-black uppercase tracking-tight m-0 leading-none">GHOSTPACE</h1>
            <p className="text-sm font-bold text-gray-500 uppercase tracking-widest mt-1">Engineering Report</p>
          </div>
          <div className="text-right">
            <p className="font-mono text-sm">{new Date().toISOString().split('T')[0]}</p>
            <p className="text-xs text-gray-500">LME Engine v1.0</p>
          </div>
        </div>
      </div>

      {/* Project Meta */}
      <div className="mb-8 grid grid-cols-2 gap-4 text-sm font-mono bg-gray-100 p-4 rounded">
        <div>
          <span className="text-gray-500 block text-xs">Project Name</span>
          <strong>{project.name}</strong>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Session</span>
          <strong>{project.session}</strong>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Primary Driver Context</span>
          <strong>{driverId || 'None'}</strong>
        </div>
        <div>
          <span className="text-gray-500 block text-xs">Model Status</span>
          <StatusBadge status={intelData.model_status} />
        </div>
      </div>

      {/* Executive Summary */}
      <div className="mb-8">
        <h2 className="text-lg font-black uppercase border-b border-gray-300 pb-2 mb-4">Executive Summary</h2>
        <div className="prose prose-sm max-w-none text-black">
          <p>
            The Linear Mixed-Effects (LME) tyre degradation model was fitted to the <strong>{project.session}</strong> dataset. 
            The model identified an estimated tyre-induced pace loss rate of <strong>{(intelData.estimated_tyre_pace_loss_rate * 1000).toFixed(1)} ms/lap</strong>.
          </p>
          <p>
            {intelData.model_status === 'GO' 
              ? "The degradation signal is statistically significant and suitable for strategic planning." 
              : "The degradation signal carries high uncertainty or failed stability checks. Exercise caution."}
          </p>
        </div>
      </div>

      {/* Key Findings */}
      <div className="mb-8">
        <h2 className="text-lg font-black uppercase border-b border-gray-300 pb-2 mb-4">LME Model Findings</h2>
        <table className="w-full text-sm border-collapse">
          <tbody>
            <tr className="border-b border-gray-200">
              <td className="py-2 font-bold text-gray-700">Estimated Tyre Pace Loss</td>
              <td className="py-2 text-right font-mono">{((intelData.estimated_tyre_pace_loss_rate || 0) * 1000).toFixed(1)} ms/lap</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 font-bold text-gray-700">Standard Error</td>
              <td className="py-2 text-right font-mono">{((intelData.tyre_slope_se || 0) * 1000).toFixed(1)} ms/lap</td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 font-bold text-gray-700">95% Confidence Interval</td>
              <td className="py-2 text-right font-mono">
                [{((intelData.tyre_slope_ci_lower || 0) * 1000).toFixed(1)}, {((intelData.tyre_slope_ci_upper || 0) * 1000).toFixed(1)}] ms/lap
              </td>
            </tr>
            <tr className="border-b border-gray-200">
              <td className="py-2 font-bold text-gray-700">Statistical Significance (p-value)</td>
              <td className="py-2 text-right font-mono">
                {intelData.tyre_slope_p_value !== undefined 
                  ? (intelData.tyre_slope_p_value < 0.001 ? '< 0.001' : intelData.tyre_slope_p_value.toFixed(4))
                  : 'N/A'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Driver Context */}
      {ghostData && (
        <div className="mb-8">
          <h2 className="text-lg font-black uppercase border-b border-gray-300 pb-2 mb-4">Driver Context: {driverId}</h2>
          <table className="w-full text-sm border-collapse">
            <tbody>
              <tr className="border-b border-gray-200">
                <td className="py-2 font-bold text-gray-700">Ghost Baseline (Base Pace)</td>
                <td className="py-2 text-right font-mono">{ghostData.ghost_baseline_value.toFixed(3)} s</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 font-bold text-gray-700">Driver Random Effect</td>
                <td className="py-2 text-right font-mono">{(ghostData.driver_random_effect * 1000).toFixed(1)} ms</td>
              </tr>
              <tr className="border-b border-gray-200">
                <td className="py-2 font-bold text-gray-700">Laps Analyzed</td>
                <td className="py-2 text-right font-mono">{ghostData.laps.length}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Oracle Validation */}
      {oracleData && (
        <div className="mb-8">
          <h2 className="text-lg font-black uppercase border-b border-gray-300 pb-2 mb-4">Practice → Race Validation</h2>
          <div className="p-4 bg-gray-50 border border-gray-200 rounded">
            <p className="text-sm font-bold mb-2">Status: {oracleData.compatibility}</p>
            <p className="text-xs text-gray-600">
              The Friday practice estimate was tested against {oracleData.sunday_scenarios?.length || 0} out-of-sample Sunday race-period scenarios.
              Approximately {oracleData.overlap_percentage?.toFixed(0)}% of tested scenarios fell within the Friday 95% confidence interval.
            </p>
          </div>
        </div>
      )}

      {/* Footer Notes */}
      <div className="mt-12 pt-4 border-t border-gray-300 text-xs text-gray-500 font-mono">
        <p className="mb-1"><strong>Scientific Disclaimer:</strong> All fuel mass values are ASSUMED priors. Exact fuel loads are UNKNOWN.</p>
        <p>Generated by GhostPace F1 Motorsport Intelligence Platform</p>
      </div>

    </div>
  );
}
