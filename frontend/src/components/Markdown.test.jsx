import { renderToStaticMarkup } from "react-dom/server";
import Markdown, { parseBlocks } from "./Markdown";

const html = (md) => renderToStaticMarkup(<Markdown>{md}</Markdown>);

test("numbered items separated by blank lines stay one list", () => {
  const blocks = parseBlocks("Intro:\n\n1. **APAC** leads\n\n2. NA second\n\nDone.");
  expect(blocks.map((b) => b.type)).toEqual(["p", "ol", "p"]);
  expect(blocks[1].items).toEqual(["**APAC** leads", "NA second"]);
});

test("renders bold, code and links as elements, not raw markup", () => {
  const out = html("**bold** and `x` see [docs](https://example.com)");
  expect(out).toContain("<strong>bold</strong>");
  expect(out).toContain("<code>x</code>");
  expect(out).toContain('href="https://example.com"');
  expect(out).not.toContain("**");
});

test("does not inject HTML from model output", () => {
  expect(html("<img src=x onerror=alert(1)>")).not.toContain("<img");
});

test("non-http links stay plain text", () => {
  expect(html("[click](javascript:alert(1))")).not.toContain("<a");
});
