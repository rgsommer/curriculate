import type { ReactElement } from "react";

// Minimal markdown renderer for AI summaries: **bold**, # headings, and
// - bullet lists become real formatting (no external dependency).
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => {
    const m = p.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <span key={i}>{p}</span>;
  });
}

export function Markdown({ text }: { text: string }) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks: ReactElement[] = [];
  let list: string[] = [];
  let key = 0;
  const flushList = () => {
    if (list.length) {
      const items = list.slice();
      blocks.push(
        <ul key={`u${key++}`} className="my-2 list-disc space-y-1 pl-5">
          {items.map((li, i) => <li key={i}>{renderInline(li)}</li>)}
        </ul>
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    if (bullet) { list.push(bullet[1]); continue; }
    flushList();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const wholeBold = line.trim().match(/^\*\*([^*]+)\*\*$/);
    if (h) {
      blocks.push(<p key={`h${key++}`} className="mb-1 mt-3 font-semibold text-slate-900">{renderInline(h[2])}</p>);
    } else if (wholeBold) {
      blocks.push(<p key={`b${key++}`} className="mb-1 mt-3 font-semibold text-slate-900">{wholeBold[1]}</p>);
    } else {
      blocks.push(<p key={`p${key++}`} className="my-1.5 leading-relaxed">{renderInline(line)}</p>);
    }
  }
  flushList();
  return <div>{blocks}</div>;
}
