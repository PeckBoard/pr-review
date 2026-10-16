import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS page module
import { inlineMarkdown, markdownToHtml } from "../page/md.js";
import {
  duration,
  filterFolders,
  formatLocation,
  groupFindings,
  progressCaption,
  relTime,
  safeUrl,
  startBlockReason,
  stepStates,
  toMs,
  validateStart,
  // @ts-expect-error plain JS page module
} from "../page/util.js";

describe("review markdown", () => {
  it("escapes HTML before inserting tags", () => {
    const html = markdownToHtml('Use <img src=x onerror="alert(1)"> **now**');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("<b>now</b>");
  });

  it("renders fences, lists, inline code, and only http(s) links", () => {
    const html = markdownToHtml(
      "Intro `a*b*c`\n\n- one\n- two\n\n```ts\nconst x = 1 < 2;\n```\n[ok](https://x.dev/a) [bad](javascript:alert(1))",
    );
    expect(html).toContain("<code>a*b*c</code>");
    expect(html).toContain("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(html).toContain("<pre><code>const x = 1 &lt; 2;</code></pre>");
    expect(html).toContain('<a href="https://x.dev/a" target="_blank" rel="noopener noreferrer">ok</a>');
    expect(html).not.toContain('href="javascript');
  });

  it("inline-only rendering for titles", () => {
    expect(inlineMarkdown("Rename `foo` <b>")).toBe("Rename <code>foo</code> &lt;b&gt;");
  });
});

describe("review helpers", () => {
  it("parses timestamps in seconds, ms, and ISO", () => {
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toMs("2026-01-01T00:00:00Z")).toBe(Date.UTC(2026, 0, 1));
    expect(toMs(null)).toBeNull();
  });

  it("formats relative times and durations", () => {
    const now = 10_000_000;
    expect(relTime(now - 10_000, now)).toBe("just now");
    expect(relTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(duration(42_000)).toBe("42s");
    expect(duration(185_000)).toBe("3m 05s");
    expect(duration(3_720_000)).toBe("1h 02m");
  });

  it("derives stepper states from status and step", () => {
    expect(stepStates({ status: "running", step: "reviewing" }).slice(0, 4)).toEqual([
      "done",
      "done",
      "active",
      "pending",
    ]);
    expect(stepStates({ status: "failed", step: "merging" })[3]).toBe("failed");
    expect(stepStates({ status: "done", step: "done" }).every((s: string) => s === "done")).toBe(true);
    expect(progressCaption({ status: "running", step: "verifying" })).toBe("Verifying · step 5 of 7");
  });

  it("validates the new-review form field by field", () => {
    const folders = [{ id: "f1", name: "app", path: "/src/app" }];
    expect(validateStart({ branch: "", folder_id: null }, folders)).toEqual({
      branch: "Enter the branch to review.",
      folder_id: "Pick the folder that holds the repository.",
    });
    expect(startBlockReason(validateStart({ branch: "", folder_id: null }, folders))).toBe(
      "Needs a branch and a target folder.",
    );
    expect(validateStart({ branch: "feat x", folder_id: "f1" }, folders).branch).toMatch(/spaces/);
    expect(validateStart({ branch: "feat/x", base: "", folder_id: "f1" }, folders)).toEqual({});
  });

  it("filters folders by every token, name prefix first", () => {
    const folders = [
      { id: "1", name: "website", path: "/work/peck/website" },
      { id: "2", name: "peckboard", path: "/work/peckboard" },
    ];
    expect(filterFolders(folders, "peck").map((f: { id: string }) => f.id)).toEqual(["2", "1"]);
    expect(filterFolders(folders, "work web").map((f: { id: string }) => f.id)).toEqual(["1"]);
  });

  it("groups findings by severity, most-agreed first", () => {
    const g = groupFindings([
      { kind: "change", severity: "major", title: "a", reviewers: ["claude"], confidence: 0.9 },
      { kind: "change", severity: "major", title: "b", reviewers: ["claude", "codex"], confidence: 0.6 },
      { kind: "praise", severity: null, title: "c", reviewers: ["grok"], confidence: 1 },
    ]);
    expect(g.major.map((f: { title: string }) => f.title)).toEqual(["b", "a"]);
    expect(g.praise).toHaveLength(1);
    expect(g.blocker).toHaveLength(0);
  });

  it("formats locations and gates link URLs", () => {
    expect(formatLocation({ file: "a.ts", line: 3, end_line: 9 })).toBe("a.ts:3–9");
    expect(formatLocation({ file: "a.ts", line: 3, end_line: 3 })).toBe("a.ts:3");
    expect(formatLocation({ file: null })).toBeNull();
    expect(safeUrl("https://github.com/o/r/issues/1")).toBe("https://github.com/o/r/issues/1");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
  });
});
