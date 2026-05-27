import { A } from '@solidjs/router';
import { splitProps, type JSX } from 'solid-js';

type BaseProps = {
  accent?: boolean;
  class?: string;
  children: JSX.Element;
};

type AsLink = BaseProps &
  Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'class' | 'children'> & {
    href: string;
  };

type AsButton = BaseProps &
  Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'class' | 'children'> & {
    href?: undefined;
  };

export type PressCardProps = AsLink | AsButton;

export default function PressCard(props: PressCardProps) {
  const [local, rest] = splitProps(props as any, ['accent', 'class', 'href', 'children']);

  const cls = () =>
    ['press-card', local.accent && 'press-card-primary', local.class]
      .filter(Boolean)
      .join(' ');

  if (local.href) {
    return (
      <A href={local.href} class={cls()} {...rest}>
        {local.children}
      </A>
    );
  }

  return (
    <button type="button" class={cls()} {...rest}>
      {local.children}
    </button>
  );
}
