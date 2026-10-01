// Minimal markdown renderer for model output: headings, paragraphs, bullet/numbered lists,
// fenced code, inline **bold**, *italic*, `code`, and [links](url). Builds React elements
// directly (never innerHTML), so model output can't inject markup.

const INLINE = /(\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\*([^*\s][^*]*)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;

function inline(text, keyPrefix) {
  const out = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = `${keyPrefix}-${i++}`;
    if (m[2] || m[3]) out.push(<strong key={key}>{inline(m[2] || m[3], key)}</strong>);
    else if (m[4]) out.push(<code key={key}>{m[4]}</code>);
    else if (m[5]) out.push(<em key={key}>{inline(m[5], key)}</em>);
    else out.push(<a key={key} href={m[7]} target="_blank" rel="noreferrer">{m[6]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function parseBlocks(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  const flush = () => { if (para.length) { blocks.push({ type: "p", text: para.join(" ") }); para = []; } };
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (/^```/.test(line.trim())) {
      flush();
      const code = [];
      while (++n < lines.length && !/^```/.test(lines[n].trim())) code.push(lines[n]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    const item = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/);
    if (!line.trim()) flush();
    else if (heading) { flush(); blocks.push({ type: "h", level: Math.min(heading[1].length + 2, 6), text: heading[2] }); }
    else if (item) {
      flush();
      const type = item[1] ? "ul" : "ol";
      const prev = blocks[blocks.length - 1];
      if (prev && prev.type === type && prev.open) prev.items.push(item[3]);
      else blocks.push({ type, open: true, start: item[2] ? Number(item[2]) : 1, items: [item[3]] });
      continue;
    } else if (/^\s{2,}\S/.test(line) && blocks[blocks.length - 1]?.open && !para.length) {
      // indented continuation of the previous list item
      const list = blocks[blocks.length - 1];
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    } else {
      // plain text ends any open list (blank lines alone don't, so "1. …\n\n2. …" stays one list)
      const prev = blocks[blocks.length - 1];
      if (prev?.open) prev.open = false;
      para.push(line.trim());
    }
  }
  flush();
  return blocks;
}

export default function Markdown({ children, ...props }) {
  const blocks = parseBlocks(String(children || ""));
  return (
    <div {...props}>
      {blocks.map((block, b) => {
        const key = `b${b}`;
        if (block.type === "code") return <pre key={key}><code>{block.text}</code></pre>;
        if (block.type === "h") { const Tag = `h${block.level}`; return <Tag key={key}>{inline(block.text, key)}</Tag>; }
        if (block.type === "ul") return <ul key={key}>{block.items.map((t, i) => <li key={i}>{inline(t, `${key}-${i}`)}</li>)}</ul>;
        if (block.type === "ol") return <ol key={key} start={block.start}>{block.items.map((t, i) => <li key={i}>{inline(t, `${key}-${i}`)}</li>)}</ol>;
        return <p key={key}>{inline(block.text, key)}</p>;
      })}
    </div>
  );
}
