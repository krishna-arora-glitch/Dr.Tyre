import { useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function SimulationView({ driver, data }) {
  const [currentLapIndex, setCurrentLapIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    setCurrentLapIndex(0);
    setIsPlaying(false);
  }, [driver, data]);

  useEffect(() => {
    let interval;
    if (isPlaying && data && data.length > 0) {
      interval = setInterval(() => {
        setCurrentLapIndex(prev => {
          if (prev < data.length - 1) return prev + 1;
          setIsPlaying(false);
          return prev;
        });
      }, 2000); // 2 seconds per lap for playback
    }
    return () => clearInterval(interval);
  }, [isPlaying, data]);

  if (!data || data.length === 0) return null;

  const currentLap = data[currentLapIndex];
  const isPitCritical = currentLap.tyre_loss > 1.5;

  // Track rendering logic
  // Ghost always reaches 95% of the path (near the end)
  // Actual car trails by tyre_loss * 5% (just for visual representation)
  const ghostProgress = 95;
  const actualProgress = Math.max(0, 95 - (currentLap.tyre_loss * 15));

  const handlePrev = () => setCurrentLapIndex(Math.max(0, currentLapIndex - 1));
  const handleNext = () => setCurrentLapIndex(Math.min(data.length - 1, currentLapIndex + 1));
  const togglePlay = () => setIsPlaying(!isPlaying);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left Column: Mission Control */}
      <div className="bg-panel p-6 rounded-lg border border-border shadow-sm col-span-1 flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-bold text-white mb-1">Mission Control</h2>
          <p className="text-muted text-sm">Target Driver: <span className="font-mono text-white font-bold">{driver}</span></p>
        </div>

        <div className="bg-background rounded p-4 border border-border">
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm text-muted font-medium uppercase tracking-wider">Pit Window Status</span>
          </div>
          {isPitCritical ? (
            <div className="bg-danger/20 border border-danger text-danger px-4 py-3 rounded flex items-start gap-3 animate-pulse">
              <AlertTriangle className="shrink-0 mt-0.5" size={20} />
              <div className="font-bold text-sm">
                ⚠️ TYRE DEGRADATION CRITICAL: RECOMMEND PIT STOP
              </div>
            </div>
          ) : (
            <div className="bg-success/20 border border-success text-success px-4 py-3 rounded flex items-center gap-3">
              <CheckCircle2 size={20} />
              <div className="font-bold text-sm">
                🟢 TYRES OPTIMAL
              </div>
            </div>
          )}
        </div>

        <div className="bg-background rounded p-4 border border-border flex-1">
          <span className="text-sm text-muted font-medium uppercase tracking-wider mb-4 block">Live Telemetry (Lap {currentLap.lap_number})</span>
          
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted">Tyre Loss</span>
              <span className="font-mono text-danger font-bold">+{currentLap.tyre_loss.toFixed(3)} s</span>
            </div>
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted">Fuel Gain</span>
              <span className="font-mono text-success font-bold">{currentLap.fuel_gain.toFixed(3)} s</span>
            </div>
            <div className="flex justify-between items-center border-b border-border/50 pb-2">
              <span className="text-muted">Driver Pacing</span>
              <span className="font-mono text-primary font-bold">
                {currentLap.residual > 0 ? '+' : ''}{currentLap.residual.toFixed(3)} s
              </span>
            </div>
            <div className="flex justify-between items-center pt-2">
              <span className="text-muted">Observed Time</span>
              <span className="font-mono text-white font-bold">{currentLap.lap_time_s.toFixed(3)} s</span>
            </div>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-between bg-background p-3 rounded border border-border">
          <button onClick={handlePrev} disabled={currentLapIndex === 0} className="p-2 text-muted hover:text-white disabled:opacity-50">
            <SkipBack size={20} />
          </button>
          <button onClick={togglePlay} className="p-3 bg-primary text-white rounded-full hover:bg-primary/80 transition-colors">
            {isPlaying ? <Pause size={20} /> : <Play size={20} className="ml-1" />}
          </button>
          <button onClick={handleNext} disabled={currentLapIndex === data.length - 1} className="p-2 text-muted hover:text-white disabled:opacity-50">
            <SkipForward size={20} />
          </button>
        </div>
      </div>

      {/* Right Column: Track Animation */}
      <div className="bg-panel p-6 rounded-lg border border-border shadow-sm col-span-1 lg:col-span-2 relative overflow-hidden flex flex-col">
        <h2 className="text-xl font-bold text-white mb-4">Live Pace Visualization</h2>
        
        <div className="flex gap-6 text-sm mb-6 bg-background/50 p-3 rounded border border-border/50 inline-flex w-fit">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(0,229,255,0.8)]"></div>
            <span className="text-muted font-medium">Ghost Baseline (Fresh Tyres)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)]"></div>
            <span className="text-muted font-medium">Actual ({driver})</span>
          </div>
        </div>

        <div className="flex-1 min-h-[300px] w-full relative flex items-center justify-center">
          <svg viewBox="0 0 800 400" className="w-full h-full drop-shadow-2xl">
            <defs>
              <linearGradient id="trackGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#1f2937" />
                <stop offset="100%" stopColor="#374151" />
              </linearGradient>
            </defs>

            {/* The Track Path */}
            <path 
              id="race-track"
              d="M 50,350 C 50,350 200,350 300,250 C 400,150 500,50 650,50 C 750,50 750,150 650,150 C 550,150 450,250 350,350 C 250,450 150,450 50,450 Z" 
              fill="none" 
              stroke="url(#trackGradient)" 
              strokeWidth="40"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            
            <path 
              d="M 50,350 C 50,350 200,350 300,250 C 400,150 500,50 650,50 C 750,50 750,150 650,150 C 550,150 450,250 350,350 C 250,450 150,450 50,450 Z" 
              fill="none" 
              stroke="#4b5563" 
              strokeWidth="2"
              strokeDasharray="10 10"
            />

            {/* Ghost Car */}
            <circle key={`ghost-${currentLapIndex}`} r="8" fill="#00e5ff" className="shadow-[0_0_15px_rgba(0,229,255,1)]">
              <animateMotion 
                dur="2s" 
                repeatCount="1"
                fill="freeze"
                keyPoints={`0;${ghostProgress/100}`}
                keyTimes="0;1"
                calcMode="linear"
              >
                <mpath href="#race-track"/>
              </animateMotion>
            </circle>

            {/* Actual Car */}
            <circle key={`actual-${currentLapIndex}`} r="8" fill="#ffffff" className="shadow-[0_0_15px_rgba(255,255,255,1)]">
              <animateMotion 
                dur="2s" 
                repeatCount="1"
                fill="freeze"
                keyPoints={`0;${actualProgress/100}`}
                keyTimes="0;1"
                calcMode="linear"
              >
                <mpath href="#race-track"/>
              </animateMotion>
            </circle>
          </svg>
        </div>
      </div>
    </div>
  );
}
