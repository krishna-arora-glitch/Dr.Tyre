import { useState, useEffect } from 'react';
import GhostBaseline from './GhostBaseline';
import DriverCalibration from './DriverCalibration';
import PracticeToRace from './PracticeToRace';
import { api } from '../api';

function FadeTransition({ show, children }) {
  return (
    <div className={`transition-opacity duration-500 ${show ? 'opacity-100' : 'opacity-0 hidden'}`}>
      {children}
    </div>
  );
}

export default function StoryMode({ sessionId, driverId, onSessionChange, onDriverSelect }) {
  const [step, setStep] = useState(1);
  const totalSteps = 7;
  const [drivers, setDrivers] = useState([]);

  useEffect(() => {
    if (!sessionId) return;
    api.getSessionStats(sessionId)
      .then(s => {
        setDrivers(s.drivers);
        if (!driverId && s.drivers.length > 0) {
          onDriverSelect(s.drivers[0]);
        }
      })
      .catch(() => {});
  }, [sessionId]);

  const handleNext = () => setStep(s => Math.min(s + 1, totalSteps));
  const handlePrev = () => setStep(s => Math.max(s - 1, 1));

  return (
    <div className="max-w-[1000px] mx-auto px-6 py-8 pb-32">
      {/* Progress Bar */}
      <div className="flex gap-2 mb-12">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div 
            key={i} 
            className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${i + 1 <= step ? 'bg-[var(--accent-cyan)]' : 'bg-[var(--border-muted)]'}`}
          />
        ))}
      </div>

      {/* Step 1: The Problem */}
      {step === 1 && (
        <div className="animate-in space-y-8">
          <h1 className="text-4xl font-bold tracking-tight mb-2">THE PROBLEM</h1>
          <h2 className="text-2xl text-[var(--text-secondary)] font-light border-l-4 border-[var(--status-nogo)] pl-4">
            Lap time does NOT tell you what the tyre is doing.
          </h2>
          
          <div className="glass-panel p-8 mt-12 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-deep)]">
            <h3 className="text-lg font-bold text-center mb-8">Raw Lap Times — {driverId || 'Driver'}</h3>
            <div className="flex flex-col items-center justify-center space-y-4 font-mono text-xl">
              <div className="text-[var(--text-muted)]">Lap 5 ..... 96.80s</div>
              <div className="text-[var(--text-muted)]">Lap 8 ..... 96.75s</div>
              <div className="text-[var(--text-primary)] font-bold text-2xl scale-110">Lap 11 .... 96.70s</div>
              <div className="text-[var(--text-muted)]">Lap 14 .... 96.82s</div>
            </div>
            
            <div className="mt-12 text-center">
              <div className="inline-block bg-[var(--bg-hover)] border border-[var(--border-default)] rounded-full px-6 py-2 text-[var(--text-primary)] font-bold tracking-wide">
                Looks stable.
              </div>
            </div>
            
            <div className="mt-8 text-center animate-[pulse_3s_ease-in-out_infinite]">
              <p className="text-[var(--status-nogo)] font-bold text-lg tracking-widest uppercase">
                But the tyre may still be losing performance.
              </p>
              <p className="text-sm text-[var(--text-secondary)] mt-2">
                Fuel burn pace gains often mask tyre degradation.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Decomposition */}
      {step === 2 && (
        <div className="animate-in space-y-8">
          <h1 className="text-4xl font-bold tracking-tight mb-2">WHY RAW DATA IS MISLEADING</h1>
          <h2 className="text-2xl text-[var(--text-secondary)] font-light border-l-4 border-[var(--accent-blue)] pl-4">
            Raw lap time is a mixture of multiple opposing effects.
          </h2>
          
          <div className="glass-panel p-8 mt-12 overflow-hidden relative">
            <div className="text-center mb-12">
              <div className="inline-block bg-[var(--bg-hover)] border-2 border-[var(--text-primary)] rounded-lg px-8 py-4 text-2xl font-bold tracking-wider shadow-[0_0_20px_rgba(255,255,255,0.1)]">
                OBSERVED LAP TIME
              </div>
              <div className="h-8 w-0.5 bg-[var(--border-muted)] mx-auto my-2" />
              <div className="text-xl text-[var(--text-muted)]">=</div>
            </div>
            
            <div className="flex flex-col gap-4 max-w-lg mx-auto">
              <div className="glass-panel p-4 border-l-4 border-[var(--chart-line-4)] flex items-center justify-between animate-in slide-in-from-right fade-in duration-500 delay-100">
                <span className="font-bold text-lg">Fuel Burn</span>
                <span className="text-[var(--status-go)] text-sm font-mono">- pace gain</span>
              </div>
              <div className="text-center text-[var(--text-muted)] font-bold">+</div>
              
              <div className="glass-panel p-4 border-l-4 border-[var(--status-nogo)] flex items-center justify-between animate-in slide-in-from-right fade-in duration-500 delay-300">
                <span className="font-bold text-lg">Tyre Contribution</span>
                <span className="text-[var(--status-nogo)] text-sm font-mono">+ pace loss</span>
              </div>
              <div className="text-center text-[var(--text-muted)] font-bold">+</div>
              
              <div className="glass-panel p-4 border-l-4 border-[var(--accent-cyan)] flex items-center justify-between animate-in slide-in-from-right fade-in duration-500 delay-500">
                <span className="font-bold text-lg">Track Evolution & Traffic</span>
                <span className="text-[var(--text-muted)] text-sm font-mono">noise</span>
              </div>
            </div>
            
            <div className="mt-12 text-center text-[var(--accent-blue)] font-bold text-xl animate-in slide-in-from-bottom fade-in duration-700 delay-1000">
              GhostPace isolates the tyre contribution.
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Ghost Baseline */}
      {step === 3 && (
        <div className="animate-in space-y-6">
          <h1 className="text-4xl font-bold tracking-tight mb-2">THE GHOST BASELINE</h1>
          <h2 className="text-2xl text-[var(--text-secondary)] font-light border-l-4 border-[var(--accent-cyan)] pl-4">
            Peeling back the layers to reveal true tyre performance.
          </h2>
          <div className="mt-8">
            <GhostBaseline sessionId={sessionId} driverId={driverId} onDriverSelect={onDriverSelect} />
          </div>
        </div>
      )}

      {/* Step 4: Evidence */}
      {step === 4 && (
        <div className="animate-in space-y-8">
          <h1 className="text-4xl font-bold tracking-tight mb-2">CAN WE TRUST THE MODEL?</h1>
          <h2 className="text-2xl text-[var(--text-secondary)] font-light border-l-4 border-[var(--status-go)] pl-4">
            A model is only as good as the evidence validating it.
          </h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
            <div className="glass-panel p-6 border-t-4 border-[var(--chart-line-4)] flex flex-col h-full hover:-translate-y-2 transition-transform">
              <h3 className="text-[var(--text-muted)] font-mono text-sm mb-4">01. FUEL SENSITIVITY</h3>
              <p className="text-lg font-bold text-[var(--text-primary)] mb-4">Does the result survive different fuel assumptions?</p>
              <p className="text-sm text-[var(--text-secondary)] mt-auto">Public data lacks fuel mass. We sweep across plausible fuel priors to ensure the degradation signal remains mathematically stable.</p>
            </div>
            
            <div className="glass-panel p-6 border-t-4 border-[var(--accent-blue)] flex flex-col h-full hover:-translate-y-2 transition-transform">
              <h3 className="text-[var(--text-muted)] font-mono text-sm mb-4">02. DRIVER HOLDOUT</h3>
              <p className="text-lg font-bold text-[var(--text-primary)] mb-4">Can the relationship transfer to an unseen driver?</p>
              <p className="text-sm text-[var(--text-secondary)] mt-auto">We use few-shot calibration to prove the global tyre physics generalize to drivers completely excluded from the model training.</p>
            </div>
            
            <div className="glass-panel p-6 border-t-4 border-[var(--status-go)] flex flex-col h-full hover:-translate-y-2 transition-transform">
              <h3 className="text-[var(--text-muted)] font-mono text-sm mb-4">03. RACE VALIDATION</h3>
              <p className="text-lg font-bold text-[var(--text-primary)] mb-4">Is Friday practice consistent with Sunday?</p>
              <p className="text-sm text-[var(--text-secondary)] mt-auto">We overlay the practice estimates against out-of-sample race-period scenarios to verify statistical compatibility.</p>
            </div>
          </div>
        </div>
      )}

      {/* Step 5: Calibration */}
      {step === 5 && (
        <div className="animate-in space-y-6">
          <h1 className="text-4xl font-bold tracking-tight mb-2">CALIBRATE A NEW DRIVER</h1>
          <h2 className="text-2xl text-[var(--text-secondary)] font-light border-l-4 border-[var(--accent-blue)] pl-4">
            We are learning the driver's baseline, not changing the tyre physics.
          </h2>
          <div className="mt-8">
            <DriverCalibration sessionId={sessionId} driverId={driverId} onDriverSelect={onDriverSelect} />
          </div>
        </div>
      )}

      {/* Step 6: Practice to Race */}
      {step === 6 && (
        <div className="animate-in space-y-6">
          <h1 className="text-4xl font-bold tracking-tight mb-2">PRACTICE VS RACE</h1>
          <h2 className="text-2xl text-[var(--text-secondary)] font-light border-l-4 border-[var(--status-go)] pl-4">
            Does the Friday estimate hold up on Sunday?
          </h2>
          <div className="mt-8">
            <PracticeToRace sessionId={sessionId} />
          </div>
        </div>
      )}

      {/* Step 7: Payoff */}
      {step === 7 && (
        <div className="animate-in space-y-12">
          <h1 className="text-4xl font-bold tracking-tight mb-2">WHAT DID GHOSTPACE ACTUALLY DO?</h1>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
            <div className="glass-panel p-6 flex items-start gap-4">
              <span className="text-2xl text-[var(--accent-cyan)]">1</span>
              <div>
                <h3 className="text-xl font-bold">Removed major pace confounders</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-2">Accounted for the fuel burn and track evolution that normally mask true tyre performance.</p>
              </div>
            </div>
            <div className="glass-panel p-6 flex items-start gap-4">
              <span className="text-2xl text-[var(--accent-cyan)]">2</span>
              <div>
                <h3 className="text-xl font-bold">Estimated tyre-induced pace loss</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-2">Quantified the specific millisecond-per-lap penalty caused purely by tyre degradation.</p>
              </div>
            </div>
            <div className="glass-panel p-6 flex items-start gap-4">
              <span className="text-2xl text-[var(--accent-cyan)]">3</span>
              <div>
                <h3 className="text-xl font-bold">Calibrated to a new driver</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-2">Proved the physics generalize to unseen drivers using only a few observation laps.</p>
              </div>
            </div>
            <div className="glass-panel p-6 flex items-start gap-4">
              <span className="text-2xl text-[var(--accent-cyan)]">4</span>
              <div>
                <h3 className="text-xl font-bold">Validated against race data</h3>
                <p className="text-sm text-[var(--text-secondary)] mt-2">Confirmed the practice estimates were statistically compatible with Sunday race-period behaviour.</p>
              </div>
            </div>
          </div>
          
          <div className="mt-16 text-center">
            <h2 className="text-sm font-bold text-[var(--text-muted)] tracking-widest uppercase mb-4">Engineering Value</h2>
            <div className="glass-panel p-8 inline-block max-w-2xl bg-gradient-to-b from-[var(--bg-elevated)] to-[var(--bg-deep)] border border-[var(--accent-blue)] relative shadow-[0_0_30px_rgba(88,166,255,0.15)]">
              <p className="text-lg text-[var(--text-secondary)] mb-6">
                Instead of asking: <br/>
                <span className="text-[var(--text-primary)] italic">"Why did the lap time change?"</span>
              </p>
              <div className="w-12 h-0.5 bg-[var(--accent-cyan)] mx-auto mb-6" />
              <p className="text-2xl font-bold text-[var(--text-primary)] leading-tight">
                GhostPace asks: <br/>
                <span className="text-[var(--accent-blue)]">"How much of that change can be attributed to the tyre?"</span>
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Controls */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[var(--bg-base)] to-transparent pointer-events-none z-50">
        <div className="max-w-[1000px] mx-auto flex justify-between pointer-events-auto">
          <button
            onClick={handlePrev}
            disabled={step === 1}
            className={`px-6 py-3 rounded-lg font-bold text-sm transition-all ${step === 1 ? 'opacity-0 cursor-default' : 'bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] shadow-lg'}`}
          >
            ← Previous
          </button>
          
          <button
            onClick={handleNext}
            disabled={step === totalSteps}
            className={`px-8 py-3 rounded-lg font-bold text-sm transition-all shadow-[0_0_20px_rgba(88,166,255,0.3)] ${step === totalSteps ? 'opacity-0 cursor-default' : 'bg-[var(--accent-blue)] text-white hover:bg-[var(--accent-cyan)]'}`}
          >
            {step === totalSteps - 1 ? 'Finish Presentation' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}
