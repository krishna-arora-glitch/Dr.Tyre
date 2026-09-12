import { useState, useEffect } from 'react';
import { storage } from '../utils/storage';
import { api } from '../api';

export default function Home({ onOpenProject, onStartDemo }) {
  const [projects, setProjects] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    setProjects(storage.getProjects());
    
    setLoadingSessions(true);
    api.getSessions()
      .then(s => setSessions(s.sessions || []))
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  const handleCreateNew = (sessionId) => {
    const newProject = {
      id: 'proj_' + Date.now(),
      name: `Analysis — ${sessionId}`,
      session: sessionId,
      driverId: 'VER',
      compareDriverId: 'LEC',
    };
    const saved = storage.saveProject(newProject);
    setProjects(storage.getProjects());
    onOpenProject(saved);
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    storage.deleteProject(id);
    setProjects(storage.getProjects());
  };

  return (
    <div className="max-w-[1440px] mx-auto px-6 py-8 animate-in">
      <div className="flex justify-between items-end mb-8 border-b border-[var(--border-default)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Command Center</h1>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Manage your analysis projects and workspace.
          </p>
        </div>
        <button
          onClick={onStartDemo}
          className="bg-[var(--accent-cyan)] text-black px-6 py-2 rounded-lg font-bold text-sm shadow-lg hover:bg-white transition-colors flex items-center gap-2"
        >
          <span>▶</span> Start Demo Mode
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column: Projects */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Recent Projects
          </h2>
          
          {projects.length === 0 ? (
            <div className="glass-panel p-8 text-center border-dashed border-[var(--border-muted)]">
              <p className="text-[var(--text-secondary)] mb-4">No active projects.</p>
              <p className="text-xs text-[var(--text-muted)]">Select a session from the library to start an analysis.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {projects.map(proj => (
                <div 
                  key={proj.id}
                  onClick={() => onOpenProject(proj)}
                  className="glass-panel p-5 cursor-pointer hover:border-[var(--accent-blue)] transition-colors group relative"
                >
                  <button 
                    onClick={(e) => handleDelete(proj.id, e)}
                    className="absolute top-3 right-3 text-[var(--text-muted)] opacity-0 group-hover:opacity-100 hover:text-[var(--status-nogo)]"
                    title="Delete Project"
                  >
                    ×
                  </button>
                  <h3 className="font-bold text-lg mb-1">{proj.name}</h3>
                  <div className="text-xs text-[var(--text-secondary)] space-y-1">
                    <p>Session: <span className="font-mono text-[var(--text-primary)]">{proj.session}</span></p>
                    <p>Driver Context: <span className="font-mono text-[var(--text-primary)]">{proj.driverId || 'None'}</span></p>
                    <p className="text-[var(--text-muted)] mt-4">
                      Last modified: {new Date(proj.lastModified).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Data Library */}
        <div className="space-y-6">
          <h2 className="text-sm font-bold uppercase tracking-widest text-[var(--text-muted)]">
            Data Library
          </h2>
          
          <div className="glass-panel p-5">
            {loadingSessions ? (
              <div className="text-sm text-[var(--text-muted)] text-center py-4">Loading sessions...</div>
            ) : (
              <div className="space-y-3">
                {sessions.map(s => (
                  <div key={s.id} className="bg-[var(--bg-hover)] rounded border border-[var(--border-default)] p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-mono text-sm font-bold">{s.label}</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--status-go)]" title="LME Model Ready" />
                    </div>
                    <button
                      onClick={() => handleCreateNew(s.id)}
                      className="w-full mt-2 text-xs py-1.5 rounded bg-[var(--bg-elevated)] hover:bg-[var(--accent-blue)] hover:text-white transition-colors border border-[var(--border-muted)]"
                    >
                      + New Analysis
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="mt-6 pt-4 border-t border-[var(--border-default)]">
              <h3 className="text-xs font-bold text-[var(--text-secondary)] mb-2">Scientific Core Active</h3>
              <ul className="text-[10px] text-[var(--text-muted)] space-y-1 font-mono">
                <li>✓ Linear Mixed-Effects (LME)</li>
                <li>✓ Few-Shot Calibration</li>
                <li>✓ Sensitivity Sweep</li>
                <li>✓ Practice-to-Race Validation</li>
              </ul>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
