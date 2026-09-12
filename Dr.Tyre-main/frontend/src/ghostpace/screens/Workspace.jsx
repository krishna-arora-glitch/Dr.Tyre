import { useState, useEffect } from 'react';
import { api } from '../api';
import { storage } from '../utils/storage';
import { DataLabel } from '../components/StatusBadge';

// Import Modes
import TyreIntelligence from './TyreIntelligence';
import GhostBaseline from './GhostBaseline';
import SensitivityLab from './SensitivityLab';
import DriverCalibration from './DriverCalibration';
import PracticeToRace from './PracticeToRace';
import CompareMode from './modes/CompareMode';
import InvestigateMode from './modes/InvestigateMode';
import ReportView from './modes/ReportView';

const MODES = [
  { id: 'analyze', label: 'Analyze', icon: '🔬' },
  { id: 'compare', label: 'Compare', icon: '⚖️' },
  { id: 'investigate', label: 'Investigate', icon: '🕵️' },
  { id: 'validate', label: 'Validate', icon: '🏁' },
  { id: 'report', label: 'Report', icon: '📄' },
];

export default function Workspace({ project, onClose }) {
  const [activeMode, setActiveMode] = useState('analyze');
  const [analyzeTab, setAnalyzeTab] = useState('intelligence');
  
  // Context state (saves back to project)
  const [driverId, setDriverId] = useState(project.driverId || 'VER');
  const [drivers, setDrivers] = useState([]);
  
  // Update project when context changes
  useEffect(() => {
    if (driverId && driverId !== project.driverId) {
      const updated = { ...project, driverId };
      storage.saveProject(updated);
    }
  }, [driverId, project]);

  // Load session meta and auto-select driver if needed
  useEffect(() => {
    if (!project.session) return;
    api.getSessionStats(project.session)
      .then(s => {
        const dList = s.drivers || [];
        setDrivers(dList);
        if (!driverId && dList.length > 0) {
          setDriverId(dList[0]);
        }
      })
      .catch(() => {});
  }, [project.session, driverId]);

  const handleDriverSelect = (d) => {
    setDriverId(d);
  };

  return (
    <div className="flex flex-col min-h-[calc(100vh-56px)] animate-in slide-in-from-bottom-4">
      {/* Workspace Header Bar */}
      <div className="bg-[var(--bg-elevated)] border-b border-[var(--border-default)] px-6 py-3 flex flex-wrap items-center justify-between gap-4 sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <button 
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white px-2 py-1 rounded hover:bg-[var(--bg-hover)] transition-colors text-sm font-bold"
          >
            ← Home
          </button>
          <div className="h-4 w-px bg-[var(--border-muted)]" />
          <h2 className="font-bold text-[var(--text-primary)]">{project.name}</h2>
          <span className="font-mono text-xs text-[var(--text-muted)] bg-[var(--bg-hover)] px-2 py-0.5 rounded border border-[var(--border-muted)]">
            {project.session}
          </span>
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">Context:</span>
          <select
            className="ghost-select text-xs py-1"
            value={driverId || ''}
            onChange={e => handleDriverSelect(e.target.value)}
          >
            <option value="" disabled>Select Driver</option>
            {drivers.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Mode Sub-Navigation */}
      <div className="bg-[var(--bg-base)] border-b border-[var(--border-default)] px-6 flex overflow-x-auto">
        {MODES.map(mode => (
          <button
            key={mode.id}
            onClick={() => setActiveMode(mode.id)}
            className={`px-4 py-3 text-sm font-bold border-b-2 whitespace-nowrap transition-colors flex items-center gap-2
              ${activeMode === mode.id 
                ? 'border-[var(--accent-blue)] text-[var(--text-primary)]' 
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
              }`}
          >
            <span>{mode.icon}</span> {mode.label}
          </button>
        ))}
      </div>

      {/* Mode Content */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto p-6 relative">
        
        {/* ANALYZE MODE */}
        {activeMode === 'analyze' && (
          <div className="space-y-6 animate-in">
            {/* Inner Analyze Tabs */}
            <div className="flex gap-2 border-b border-[var(--border-muted)] pb-2 mb-6">
              {[
                { id: 'intelligence', label: 'Tyre Intelligence' },
                { id: 'baseline', label: 'Ghost Baseline' },
                { id: 'sensitivity', label: 'Sensitivity Lab' },
                { id: 'calibration', label: 'Driver Calibration' },
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setAnalyzeTab(tab.id)}
                  className={`px-3 py-1 text-xs rounded-md font-bold transition-all ${
                    analyzeTab === tab.id 
                      ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-default)]' 
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {analyzeTab === 'intelligence' && <TyreIntelligence sessionId={project.session} />}
            {analyzeTab === 'baseline' && <GhostBaseline sessionId={project.session} driverId={driverId} onDriverSelect={handleDriverSelect} />}
            {analyzeTab === 'sensitivity' && <SensitivityLab sessionId={project.session} />}
            {analyzeTab === 'calibration' && <DriverCalibration sessionId={project.session} driverId={driverId} onDriverSelect={handleDriverSelect} />}
          </div>
        )}

        {/* COMPARE MODE */}
        {activeMode === 'compare' && (
          <CompareMode 
            sessionId={project.session} 
            baseDriverId={driverId} 
            drivers={drivers}
          />
        )}

        {/* INVESTIGATE MODE */}
        {activeMode === 'investigate' && (
          <InvestigateMode 
            sessionId={project.session}
            driverId={driverId}
          />
        )}

        {/* VALIDATE MODE */}
        {activeMode === 'validate' && (
          <div className="animate-in">
            <PracticeToRace sessionId={project.session} />
          </div>
        )}

        {/* REPORT MODE */}
        {activeMode === 'report' && (
          <ReportView 
            project={project}
            driverId={driverId}
          />
        )}

      </div>
    </div>
  );
}
