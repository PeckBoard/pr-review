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
  /// Per-finding triage, keyed by the finding's index in result.findings.
  triage?: Record<string, TriageEntry>;
  /// The latest publish of this review to GitHub (null until published).
  publish?: Publish | null;
  /// Watchdog: consecutive runs that ended without progress or a submit.
  /// Internal — stripped from route responses.
  nudges?: number;
}

/// The reviewer's own call — never derived from the findings or the model's
/// verdict.
export type Decision = "approve" | "request_changes" | "comment";
export const DECISIONS: Decision[] = ["approve", "request_changes", "comment"];

export interface TriageEntry {
  ignored: boolean;
  /// Replacement comment text; null keeps the finding's own wording.
  comment: string | null;
}

export interface Publish {
  decision: Decision;
  body: string;
  status: "running" | "posted" | "failed";
  session_id: string | null;
  pr_url: string | null;
  error: string | null;
  comments_posted: number | null;
  started_at: string;
  finished_at: string | null;
  /// Session that published via pr_review_publish (gets the outcome).
  requested_by: string | null;
  /// Internal watchdog counter — stripped from route responses.
  nudges?: number;
}
