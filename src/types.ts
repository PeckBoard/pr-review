// Shared shapes. These ARE the route contract the PR Reviews page reads —
// change a field here and the page must change with it.

export type Status = "queued" | "running" | "done" | "failed" | "cancelled";
export type Step =
  | "starting"
  | "context"
  | "reviewing"
  | "merging"
  | "verifying"
  | "submitting"
  | "done";
export type ProviderStatus = "pending" | "running" | "done" | "failed";
export type Severity = "blocker" | "major" | "minor" | "nit";
export type Verdict = "approve" | "approve_with_comments" | "request_changes";

export const STEPS: Step[] = [
  "starting",
  "context",
  "reviewing",
  "merging",
  "verifying",
  "submitting",
  "done",
];
export const PROVIDER_STATUSES: ProviderStatus[] = ["pending", "running", "done", "failed"];
export const SEVERITIES: Severity[] = ["blocker", "major", "minor", "nit"];
export const VERDICTS: Verdict[] = ["approve", "approve_with_comments", "request_changes"];

/// The three reviewer providers the default orchestration fans out to.
export const DEFAULT_PROVIDERS = ["claude", "codex", "grok"];

export interface Finding {
  kind: "change" | "praise";
  severity: Severity | null;
  file: string | null;
  line: number | null;
  end_line: number | null;
  title: string;
  detail: string;
  suggestion: string | null;
  reviewers: string[];
  confidence: number;
}

export interface Result {
  summary: string;
  why: string;
  ticket: { id: string; url: string | null; title: string | null } | null;
  verdict: Verdict;
  findings: Finding[];
  reviewers_failed: string[];
  dropped: { title: string; reason: string }[];
}

export interface Counts {
  blocker: number;
  major: number;
  minor: number;
  nit: number;
  praise: number;
}

export interface LogEntry {
  at: string;
  step: Step;
  note: string;
}

export interface Review {
  id: string;
  branch: string;
  base: string | null;
  folder_id: string;
  folder_name: string;
  folder_path: string;
  model: string;
  custom_prompt: string;
  session_id: string | null;
  status: Status;
  step: Step;
  log: LogEntry[];
  providers: Record<string, ProviderStatus>;
  counts: Counts;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
  error: string | null;
  /// The session that started this review through `pr_review_start` (null
  /// when started from the page). With `notify`, it gets a message when the
  /// review finishes.
  requested_by?: string | null;
  notify?: boolean;
  result: Result | null;
  /// Watchdog: consecutive runs that ended without progress or a submit.
  /// Internal — stripped from route responses.
  nudges?: number;
}
