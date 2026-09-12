export function ChartPanel({ title, subtitle, children, className = '' }) {
  return (
    <div className={`glass-panel p-5 ${className}`}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        {subtitle && (
          <p className="text-xs text-[var(--text-secondary)] mt-1">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

export function MetricCard({ label, value, unit, sublabel, status }) {
  return (
    <div className="metric-card">
      <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1 font-medium">
        {label}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-xl font-bold text-mono text-[var(--text-primary)]">
          {value}
        </span>
        {unit && <span className="text-xs text-[var(--text-secondary)]">{unit}</span>}
      </div>
      {sublabel && (
        <div className="text-xs text-[var(--text-secondary)] mt-1">{sublabel}</div>
      )}
      {status && <div className="mt-2">{status}</div>}
    </div>
  );
}

export function LoadingState({ message = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4 animate-in">
      <div className="spinner" />
      <span className="text-sm text-[var(--text-secondary)]">{message}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 animate-in">
      <div className="text-3xl">⚠️</div>
      <span className="text-sm text-[var(--status-nogo)]">{message}</span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="text-xs text-[var(--accent-blue)] hover:underline mt-1"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message = 'No data available' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 animate-in">
      <div className="text-3xl opacity-30">📊</div>
      <span className="text-sm text-[var(--text-muted)]">{message}</span>
    </div>
  );
}
