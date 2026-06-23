import { A } from '@solidjs/router';

type BrokerTab = 'deployments' | 'secrets' | 'proxmox';

export default function BrokerTabs(props: { active: BrokerTab }) {
  const tabClass = (tab: BrokerTab) =>
    `press press-sm ${props.active === tab ? 'press-primary' : 'press-ghost'}`;

  return (
    <div class="flex gap-2 flex-wrap mb-5">
      <A href="/broker" class={tabClass('deployments')}>Deployments</A>
      <A href="/broker/secrets" class={tabClass('secrets')}>Secrets</A>
      <A href="/broker/proxmox" class={tabClass('proxmox')}>Proxmox</A>
    </div>
  );
}
