import { createMemo, For } from 'solid-js';
import { parseMarkdown, safeHref, type BlockNode, type InlineNode } from '../lib/markdown';

function Inline(props: { node: InlineNode }) {
  const n = props.node;
  if (n.type === 'text') return <>{n.text}</>;
  if (n.type === 'br') return <br />;
  if (n.type === 'code') return <code>{n.text}</code>;
  if (n.type === 'bold') return <strong><For each={n.children}>{(c) => <Inline node={c} />}</For></strong>;
  if (n.type === 'italic') return <em><For each={n.children}>{(c) => <Inline node={c} />}</For></em>;
  return <a href={safeHref(n.href)} target="_blank" rel="noopener noreferrer">{n.text}</a>;
}

function InlineList(props: { children: InlineNode[] }) {
  return <For each={props.children}>{(c) => <Inline node={c} />}</For>;
}

function Block(props: { node: BlockNode }) {
  const n = props.node;
  if (n.type === 'heading') {
    if (n.level === 1) return <h1><InlineList children={n.children} /></h1>;
    if (n.level === 2) return <h2><InlineList children={n.children} /></h2>;
    return <h3><InlineList children={n.children} /></h3>;
  }
  if (n.type === 'paragraph') return <p><InlineList children={n.children} /></p>;
  if (n.type === 'codeBlock') return <pre><code>{n.text}</code></pre>;
  if (n.type === 'list') {
    const items = <For each={n.items}>{(item) => <li><InlineList children={item} /></li>}</For>;
    return n.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
  }
  if (n.type === 'blockquote') {
    return <blockquote><For each={n.children}>{(b) => <Block node={b} />}</For></blockquote>;
  }
  return <hr />;
}

export default function MarkdownRenderer(props: { content: string }) {
  const blocks = createMemo(() => parseMarkdown(props.content || ''));
  return (
    <div class="md-body">
      <For each={blocks()}>{(b) => <Block node={b} />}</For>
    </div>
  );
}
