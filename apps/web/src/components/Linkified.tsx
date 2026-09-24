import type { CSSProperties } from 'react';
import { splitLinks } from '../lib/linkify';

/** A note's text with every URL drawn as a link. See lib/linkify.ts. */
export function Linkified({ text, linkStyle }: { text: string; linkStyle?: CSSProperties }) {
  return (
    <>
      {splitLinks(text).map((r, k) => r.kind === 'text' ? r.text : (
        <a
          key={k}
          href={r.url}
          target="_blank"
          rel="noopener noreferrer"
          title={r.url}
          onClick={(e) => e.stopPropagation()}
          style={{ color: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2, fontWeight: 700, wordBreak: 'break-all', ...linkStyle }}
        >
          🔗 {r.label}
        </a>
      ))}
    </>
  );
}
