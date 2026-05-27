export default function StatusBadge(props: { status: string | null }) {
  const isPartner = () => (props.status || '').toLowerCase() === 'partner';

  const variant = () =>
    isPartner()
      ? 'bg-papaya-500/15 text-papaya-200 border-papaya-500/50'
      : 'bg-surf-500/15 text-surf-300 border-surf-500/50';

  const label = () => isPartner() ? 'Partner' : 'Account';

  return (
    <span class={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border-2 ${variant()}`}>
      {label()}
    </span>
  );
}
