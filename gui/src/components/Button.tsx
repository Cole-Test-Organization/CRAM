import { A } from '@solidjs/router';
import { splitProps, type JSX } from 'solid-js';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'default';
export type ButtonSize = 'sm' | 'md' | 'lg';

type BaseProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  class?: string;
  children: JSX.Element;
};

type ButtonElProps = BaseProps &
  Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'class' | 'children'> & {
    href?: undefined;
    type?: 'button' | 'submit' | 'reset';
  };

type LinkElProps = BaseProps &
  Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'class' | 'children'> & {
    href: string;
  };

export type ButtonProps = ButtonElProps | LinkElProps;

function variantClass(v?: ButtonVariant) {
  switch (v) {
    case 'primary': return 'press-primary';
    case 'secondary': return 'press-secondary';
    case 'danger': return 'press-danger';
    case 'ghost': return 'press-ghost';
    default: return '';
  }
}

function sizeClass(s?: ButtonSize) {
  if (s === 'sm') return 'press-sm';
  if (s === 'lg') return 'press-lg';
  return 'press-md';
}

export default function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props as any, ['variant', 'size', 'class', 'href', 'children', 'type']);

  const cls = () =>
    ['press', variantClass(local.variant), sizeClass(local.size), local.class]
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
    <button type={local.type || 'button'} class={cls()} {...rest}>
      {local.children}
    </button>
  );
}
