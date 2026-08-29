import { useState } from 'react';

export function WhyItMatters({ children }) {
  return (
    <div className="glass-panel p-4 my-6 border-[var(--accent-blue)] border-l-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">💡</span>
        <h4 className="text-[10px] font-bold text-[var(--text-muted)] tracking-widest uppercase">
          Why It Matters
        </h4>
      </div>
      <p className="text-sm text-[var(--text-primary)] leading-relaxed">
        {children}
      </p>
    </div>
  );
}

export function MethodAtAGlance() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    { label: 'OBSERVE', desc: 'FastF1 lap timing and session data' },
    { label: 'CLEAN', desc: 'Remove invalid/non-representative laps' },
    { label: 'SEPARATE', desc: 'Account for fuel and track evolution' },
    { label: 'CALIBRATE', desc: 'Estimate driver-specific baseline from K observed laps' },
    { label: 'ESTIMATE', desc: 'Estimate tyre-induced pace loss' },
    { label: 'VALIDATE', desc: 'Compare practice with unseen race-period data' },
  ];

  return (
    <div className="glass-panel p-5 my-6">
      <h3 className="text-xs font-semibold mb-4 text-[var(--text-secondary)] uppercase tracking-wider">
        Methodology Pipeline
      </h3>
      <div className="flex flex-col md:flex-row gap-2 md:gap-0 justify-between relative">
        {/* Connector line for desktop */}
        <div className="hidden md:block absolute top-1/2 left-4 right-4 h-0.5 bg-[var(--border-muted)] -z-10" />
        
        {steps.map((step, idx) => {
          const isActive = activeStep === idx;
          return (
            <div key={step.label} className="flex-1 px-1">
              <button
                onClick={() => setActiveStep(idx)}
                className={`w-full text-center px-2 py-2 rounded-lg text-xs font-bold transition-all
                  ${isActive 
                    ? 'bg-[var(--accent-blue)] text-white shadow-[0_0_15px_rgba(88,166,255,0.4)] transform scale-105' 
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]'
                  }`}
              >
                {step.label}
              </button>
            </div>
          );
        })}
      </div>
      
      {/* Explanation Box */}
      <div className="mt-4 p-4 rounded bg-[var(--bg-elevated)] border border-[var(--border-default)] min-h-[70px] flex items-center justify-center animate-in">
        <p className="text-sm text-center text-[var(--text-primary)]">
          <strong className="text-[var(--accent-blue)] mr-2">{steps[activeStep].label}:</strong>
          {steps[activeStep].desc}
        </p>
      </div>
    </div>
  );
}
