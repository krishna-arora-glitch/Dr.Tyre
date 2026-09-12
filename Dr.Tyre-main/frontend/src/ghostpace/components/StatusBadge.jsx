export function StatusBadge({ status }) {
  const map = {
    'GO': 'badge badge-go',
    'CAUTION': 'badge badge-caution',
    'NO-GO': 'badge badge-nogo',
    'STABLE': 'badge badge-go',
    'MODERATE': 'badge badge-caution',
    'UNSTABLE': 'badge badge-nogo',
    'STATISTICALLY_COMPATIBLE': 'badge badge-go',
    'INCOMPATIBLE': 'badge badge-nogo',
  };
  const dotMap = {
    'GO': 'bg-green-400',
    'CAUTION': 'bg-yellow-400',
    'NO-GO': 'bg-red-400',
    'STABLE': 'bg-green-400',
    'MODERATE': 'bg-yellow-400',
    'UNSTABLE': 'bg-red-400',
    'STATISTICALLY_COMPATIBLE': 'bg-green-400',
    'INCOMPATIBLE': 'bg-red-400',
  };
  const cls = map[status] || 'badge badge-caution';
  const dotCls = dotMap[status] || 'bg-yellow-400';
  return (
    <span className={cls}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotCls}`} />
      {status}
    </span>
  );
}

export function DataLabel({ type }) {
  const cls = {
    OBSERVED: 'data-label data-label-observed',
    ESTIMATED: 'data-label data-label-estimated',
    ASSUMED: 'data-label data-label-assumed',
    UNKNOWN: 'data-label data-label-unknown',
  };
  return <span className={cls[type] || cls.UNKNOWN}>{type}</span>;
}
