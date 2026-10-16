// Escape-first mini-markdown for agent-written review text (summary, why,
// finding details). Pure — unit-tested without a DOM. Escaping happens
// BEFORE any tag insertion, so review content can never smuggle markup into
// the page. Supports fenced code, inline code, bold/italic, lists, headings
// (rendered small), and http(s) links that open in a new tab.

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function decorate(s) {
  return (
    s
      // Closed URL charset over already-escaped text: no quote can appear,
      // so the href attribute cannot be broken out of.
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^\s)<>"]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
      )
      .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1<i>$2</i>")
  );
}

// `s` is already escaped. Code spans are split out first so their contents
// never get bold/italic/link treatment.
function inline(s) {
  return s
    .split(/(`[^`]+`)/g)
    .map((part) =>
      part.length > 1 && part.startsWith("`") && part.endsWith("`")
        ? "<code>" + part.slice(1, -1) + "</code>"
        : decorate(part),
    )
    .join("");
}

/** Inline-only markdown for one-line strings (finding titles). */
export function inlineMarkdown(s) {
  return inline(escapeHtml(s || ""));
}

export function markdownToHtml(md) {
  const lines = escapeHtml(md || "").split(/\r?\n/);
  const out = [];
  let para = [];
  let list = null; // "ul" | "ol" | null
  let fence = null; // lines inside ``` … ```

  const flushPara = () => {
    if (para.length) out.push("<p>" + inline(para.join(" ")) + "</p>");
    para = [];
  };
  const closeList = () => {
    if (list) out.push("</" + list + ">");
    list = null;
  };

  for (const line of lines) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        out.push("<pre><code>" + fence.join("\n") + "</code></pre>");
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    if (/^\s*```/.test(line)) {
      flushPara();
      closeList();
      fence = [];
      continue;
    }
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) {
      flushPara();
      closeList();
      out.push('<h4 class="md-h">' + inline(h[1]) + "</h4>");
    } else if (ul || ol) {
      flushPara();
      const kind = ul ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push("<" + kind + ">");
        list = kind;
      }
      out.push("<li>" + inline((ul || ol)[1]) + "</li>");
    } else if (line.trim() === "") {
      flushPara();
      closeList();
    } else {
      closeList();
      para.push(line.trim());
    }
  }
  if (fence !== null) out.push("<pre><code>" + fence.join("\n") + "</code></pre>");
  flushPara();
  closeList();
  return out.join("\n");
}
