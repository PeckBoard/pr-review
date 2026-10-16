// Strict validation of a submitted review result. Pure. Every problem is
// collected with its JSON path so one tool error tells the agent everything
// to fix before it resubmits — a half-valid result is never stored.

import { Counts, Finding, Result, SEVERITIES, Severity, VERDICTS, Verdict } from "./types";

const MAX_FINDINGS = 100;
const MAX_PRAISE = 5;
const MAX_ERRORS = 25;

export type Validation = { ok: true; result: Result } | { ok: false; errors: string[] };

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function nonEmpty(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function optString(v: unknown): string | null | undefined {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? (v.trim() ? v : null) : undefined;
}

const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, major: 1, minor: 2, nit: 3 };

/// Validate (and normalize) a result. Accepts a JSON string too — agents
/// sometimes stringify the object.
export function validateResult(raw: unknown): Validation {
  let input = raw;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch (_e) {
      return { ok: false, errors: ["result: a string was given but it is not valid JSON"] };
    }
  }
  const errors: string[] = [];
  const err = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };
  if (!isObj(input)) {
    return { ok: false, errors: ["result: must be an object"] };
  }

  if (!nonEmpty(input.summary)) err("result.summary: required non-empty string (2-5 sentences)");
  if (!nonEmpty(input.why)) err("result.why: required non-empty string ('unclear' if unknown)");

  let ticket: Result["ticket"] = null;
  if (input.ticket !== undefined && input.ticket !== null) {
    if (!isObj(input.ticket)) {
      err("result.ticket: must be null or an object {id, url, title}");
    } else if (!nonEmpty(input.ticket.id)) {
      err("result.ticket.id: required non-empty string (use ticket: null when there is no ticket)");
    } else {
      const url = optString(input.ticket.url);
      const title = optString(input.ticket.title);
      if (url === undefined) err("result.ticket.url: must be a string or null");
      if (title === undefined) err("result.ticket.title: must be a string or null");
      ticket = { id: input.ticket.id.trim(), url: url ?? null, title: title ?? null };
    }
  }

  const verdict = input.verdict as Verdict;
  if (!VERDICTS.includes(verdict)) {
    err(`result.verdict: must be one of ${VERDICTS.join(", ")}`);
  }

  const findings: Finding[] = [];
  if (!Array.isArray(input.findings)) {
    err("result.findings: required array (may be empty)");
  } else {
    if (input.findings.length > MAX_FINDINGS) {
      err(`result.findings: at most ${MAX_FINDINGS} entries`);
    }
    input.findings.slice(0, MAX_FINDINGS).forEach((f: unknown, i: number) => {
      const p = `result.findings[${i}]`;
      if (!isObj(f)) {
        err(`${p}: must be an object`);
        return;
      }
      const kind = f.kind;
      if (kind !== "change" && kind !== "praise") {
        err(`${p}.kind: must be 'change' or 'praise'`);
      }
      let severity: Severity | null = null;
      if (kind === "change") {
        if (!SEVERITIES.includes(f.severity as Severity)) {
          err(`${p}.severity: a change needs one of ${SEVERITIES.join(", ")}`);
        } else {
          severity = f.severity as Severity;
        }
      } else if (kind === "praise" && f.severity !== undefined && f.severity !== null) {
        err(`${p}.severity: must be null for praise`);
      }
      const file = optString(f.file);
      if (file === undefined) err(`${p}.file: must be a string or null`);
      let line: number | null = null;
      if (f.line !== undefined && f.line !== null) {
        if (!Number.isInteger(f.line) || (f.line as number) < 1) {
          err(`${p}.line: must be a positive integer (new-file line number) or null`);
        } else {
          line = f.line as number;
        }
      }
      let endLine: number | null = null;
      if (f.end_line !== undefined && f.end_line !== null) {
        if (!Number.isInteger(f.end_line) || (f.end_line as number) < 1) {
          err(`${p}.end_line: must be a positive integer or null`);
        } else if (line === null) {
          err(`${p}.end_line: requires line`);
        } else if ((f.end_line as number) < line) {
          err(`${p}.end_line: must be >= line`);
        } else {
          endLine = f.end_line as number;
        }
      }
      if (line !== null && !file) err(`${p}.line: requires file`);
      if (!nonEmpty(f.title)) err(`${p}.title: required non-empty string`);
      if (!nonEmpty(f.detail)) err(`${p}.detail: required non-empty string`);
      const suggestion = optString(f.suggestion);
      if (suggestion === undefined) err(`${p}.suggestion: must be a string or null`);
      let reviewers: string[] = [];
      if (!Array.isArray(f.reviewers) || !f.reviewers.every(nonEmpty)) {
        err(`${p}.reviewers: required array of provider names, e.g. ["claude", "codex"]`);
      } else {
        reviewers = (f.reviewers as string[]).map((r) => r.trim());
      }
      const conf = f.confidence;
      if (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 1) {
        err(`${p}.confidence: required number between 0 and 1`);
      }
      findings.push({
        kind: kind === "praise" ? "praise" : "change",
        severity,
        file: file ?? null,
        line,
        end_line: endLine,
        title: nonEmpty(f.title) ? f.title.trim() : "",
        detail: typeof f.detail === "string" ? f.detail : "",
        suggestion: suggestion ?? null,
        reviewers,
        confidence: typeof conf === "number" ? conf : 0,
      });
    });
  }

  const praise = findings.filter((f) => f.kind === "praise").length;
  if (praise > MAX_PRAISE) err(`result.findings: at most ${MAX_PRAISE} praise entries (got ${praise})`);
  if (verdict === "approve" && findings.some((f) => f.severity === "blocker")) {
    err("result.verdict: cannot be 'approve' while a blocker finding stands");
  }

  let reviewersFailed: string[] = [];
  if (input.reviewers_failed === undefined || input.reviewers_failed === null) {
    reviewersFailed = [];
  } else if (!Array.isArray(input.reviewers_failed) || !input.reviewers_failed.every(nonEmpty)) {
    err("result.reviewers_failed: must be an array of provider names");
  } else {
    reviewersFailed = (input.reviewers_failed as string[]).map((r) => r.trim());
  }

  const dropped: Result["dropped"] = [];
  if (input.dropped !== undefined && input.dropped !== null) {
    if (!Array.isArray(input.dropped)) {
      err("result.dropped: must be an array of {title, reason}");
    } else {
      input.dropped.forEach((d: unknown, i: number) => {
        if (!isObj(d) || !nonEmpty(d.title) || !nonEmpty(d.reason)) {
          err(`result.dropped[${i}]: needs non-empty title and reason`);
        } else {
          dropped.push({ title: d.title.trim(), reason: d.reason.trim() });
        }
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    result: {
      summary: (input.summary as string).trim(),
      why: (input.why as string).trim(),
      ticket,
      verdict,
      findings: sortFindings(findings),
      reviewers_failed: reviewersFailed,
      dropped,
    },
  };
}

/// Stable sort: changes by severity (blocker first), then praise. The
/// agent's order within a severity (consensus first) is kept.
export function sortFindings(findings: Finding[]): Finding[] {
  const rank = (f: Finding) => (f.kind === "praise" ? 9 : SEVERITY_RANK[f.severity as Severity]);
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
    .map((x) => x.f);
}

export function emptyCounts(): Counts {
  return { blocker: 0, major: 0, minor: 0, nit: 0, praise: 0 };
}

export function countFindings(findings: Finding[]): Counts {
  const c = emptyCounts();
  for (const f of findings) {
    if (f.kind === "praise") c.praise++;
    else if (f.severity) c[f.severity]++;
  }
  return c;
}
