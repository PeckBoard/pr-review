// Shared test data.

/// A result that passes validation: one praise, one minor, one blocker.
export function validResult(): any {
  return {
    summary: "Adds retry to the uploader.",
    why: "Uploads failed on flaky networks (ABC-12).",
    ticket: { id: "ABC-12", url: null, title: null },
    verdict: "request_changes",
    findings: [
      {
        kind: "praise",
        severity: null,
        file: null,
        line: null,
        end_line: null,
        title: "Good backoff test",
        detail: "Covers jitter bounds.",
        suggestion: null,
        reviewers: ["claude"],
        confidence: 0.9,
      },
      {
        kind: "change",
        severity: "minor",
        file: "src/a.ts",
        line: 3,
        end_line: null,
        title: "Unused import",
        detail: "x",
        suggestion: null,
        reviewers: ["grok"],
        confidence: 0.8,
      },
      {
        kind: "change",
        severity: "blocker",
        file: "src/up.ts",
        line: 10,
        end_line: 12,
        title: "Retry loop never ends",
        detail: "When the server returns 500 forever the loop spins.",
        suggestion: "Cap attempts at 5.",
        reviewers: ["claude", "codex"],
        confidence: 1,
      },
    ],
    reviewers_failed: [],
    dropped: [{ title: "Race in cache", reason: "cache is per-request" }],
  };
}
