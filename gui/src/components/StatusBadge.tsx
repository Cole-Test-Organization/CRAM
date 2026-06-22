type StatusTone = 'surf' | 'papaya' | 'scarlet' | 'amber' | 'base' | 'cerulean';

function toneClass(tone: StatusTone) {
  switch (tone) {
    case 'papaya': return 'bg-papaya-500/15 text-papaya-200 border-papaya-500/50';
    case 'scarlet': return 'bg-scarlet-500/15 text-scarlet-300 border-scarlet-500/50';
    case 'amber': return 'bg-amber-300/15 text-amber-300 border-amber-300/60';
    case 'cerulean': return 'bg-cerulean-500/15 text-cerulean-200 border-cerulean-500/50';
    case 'base': return 'bg-base-700 text-base-200 border-base-500';
    default: return 'bg-surf-500/15 text-surf-300 border-surf-500/50';
  }
}

export default function StatusBadge(props: { status: string | null; label?: string; tone?: StatusTone }) {
  const normalized = () => (props.status || '').toLowerCase();

  const inferredTone = (): StatusTone => {
    const status = normalized();
    if (status === 'partner') return 'papaya';
    if (['succeeded', 'ready', 'running', 'stored'].includes(status)) return 'surf';
    if (['queued', 'terraform_applying', 'terraform_destroying', 'destroy_requested', 'pending', 'stopping', 'missing'].includes(status)) return 'amber';
    if (['failed', 'canceled', 'destroyed', 'terminated'].includes(status)) return 'scarlet';
    if (['stopped', 'idle', 'stored-only'].includes(status)) return 'base';
    return 'cerulean';
  };

  const variant = () =>
    props.tone
      ? toneClass(props.tone)
      : toneClass(inferredTone());

  const label = () => props.label ?? (props.status || 'unknown').replace(/[-_]/g, ' ');

  return (
    <span class={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border-2 ${variant()}`}>
      {label()}
    </span>
  );
}
