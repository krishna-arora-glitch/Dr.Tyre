import { useState, useEffect } from 'react';
import Home from './screens/Home';
import Workspace from './screens/Workspace';
import StoryMode from './screens/StoryMode';
import { storage } from './utils/storage';
import { Ghost } from 'lucide-react';

export default function App() {
  const [currentRoute, setCurrentRoute] = useState('home'); // 'home' | 'workspace' | 'demo'
  const [activeProject, setActiveProject] = useState(null);

  // Restore project on mount or when route changes
  useEffect(() => {
    if (currentRoute === 'workspace' && !activeProject) {
      const projects = storage.getProjects();
      if (projects.length > 0) {
        setActiveProject(projects[0]);
      } else {
        const defaultProj = {
          id: 'proj_' + Date.now(),
          name: 'Analysis — 2024 Bahrain GP FP2',
          session: '2024_bahrain_fp2',
          driverId: 'VER',
          compareDriverId: 'LEC',
        };
        storage.saveProject(defaultProj);
        setActiveProject(defaultProj);
      }
    }
  }, [currentRoute, activeProject]);

  // For Demo Mode
  const [demoSessionId, setDemoSessionId] = useState('2024_bahrain_fp2');
  const [demoDriverId, setDemoDriverId] = useState('VER');

  const handleOpenProject = (project) => {
    setActiveProject(project);
    setCurrentRoute('workspace');
  };

  const handleCloseProject = () => {
    setActiveProject(null);
    setCurrentRoute('home');
  };

  const handleStartDemo = () => {
    setCurrentRoute('demo');
  };

  const handleCloseDemo = () => {
    setCurrentRoute('home');
  };

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)] font-sans">
      
      {/* Global Header */}
      <header className="bg-[var(--bg-elevated)] border-b border-[var(--border-default)] px-6 py-3 flex items-center justify-between sticky top-0 z-50 shadow-sm">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentRoute('home')}>
          <Ghost className="w-6 h-6 text-[var(--accent-cyan)]" />
          <h1 className="font-black tracking-tighter text-xl bg-gradient-to-r from-[var(--text-primary)] to-[var(--text-secondary)] bg-clip-text text-transparent">
            GHOSTPACE
          </h1>
          {currentRoute === 'demo' && (
            <span className="ml-2 px-2 py-0.5 rounded text-[10px] font-bold tracking-widest uppercase bg-[var(--accent-blue)] text-white">
              Demo Mode
            </span>
          )}
        </div>
        
        {currentRoute === 'demo' && (
          <button 
            onClick={handleCloseDemo}
            className="text-xs font-bold text-[var(--text-muted)] hover:text-white transition-colors border border-[var(--border-muted)] px-3 py-1 rounded"
          >
            Exit Demo
          </button>
        )}
      </header>

      {/* Main Content Router */}
      <main className="relative">
        
        {currentRoute === 'home' && (
          <Home 
            onOpenProject={handleOpenProject} 
            onStartDemo={handleStartDemo} 
          />
        )}

        {currentRoute === 'workspace' && activeProject && (
          <Workspace 
            project={activeProject} 
            onClose={handleCloseProject} 
          />
        )}

        {currentRoute === 'demo' && (
          <StoryMode 
            sessionId={demoSessionId}
            driverId={demoDriverId}
            onSessionChange={setDemoSessionId}
            onDriverSelect={setDemoDriverId}
          />
        )}

      </main>

    </div>
  );
}
