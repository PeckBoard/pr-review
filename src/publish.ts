// Triage + publish: after a review is done the user ignores / rewords
// findings, picks the decision THEMSELVES (approve / request changes /
// comment — never derived from the findings or the model's verdict), and a
// publish session posts ONE GitHub review on the branch's PR via `gh`.
//
//   done ──triage*──► publish(decision) ──► running ──result──► posted
//                                              └──fail / watchdog──► failed ──publish again──► running
//
// The publish session reports back through `pr_review_publish_result`;
// `session_index/<sid>` maps it to the review with `kind: "publish"`.

import {
  createSession,
  dispatchCapture,
  listFolders,
  orchestrateCreateSession,
  orchestrateSend,
  storeGet,
  storePut,
} from "./host";
import {
  addLog,
  assertNotReviewSession,
  loadReview,
  publicReview,
  requireReview,
  saveReview,
  SESSION_INDEX,
} from "./review";
import { Decision, DECISIONS, Finding, Publish, Review, TriageEntry } from "./types";

const MAX_COMMENT = 10_000;
const MAX_BODY = 60_000;
/// Publish runs that may end without reporting before the publish fails.
export const MAX_PUBLISH_NUDGES = 1;

const DECISION_EVENT: Record<Decision, string> = {
  approve: "APPROVE",
  request_changes: "REQUEST_CHANGES",
  comment: "COMMENT",
};
const DECISION_LABEL: Record<Decision, string> = {
  approve: "Approved",
  request_changes: "Changes requested",
  comment: "Commented",
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function now(): string {
  return new Date().toISOString();
}
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Comment text ────────────────────────────────────────────────────────────

/// Conventional Comments label. Severity picks the label only — it never
/// decides the review's outcome.
export function labelFor(f: Finding): string {
  if (f.kind === "praise") return "praise";
  switch (f.severity) {
    case "blocker":
      return "issue (blocking)";
    case "major":
      return "issue";
    case "nit":
      return "nitpick";
    default:
      return "suggestion";
  }
}

function defaultText(f: Finding): string {
  const parts = [`**${f.title}**`, f.detail];
  if (f.suggestion) parts.push(`Suggested fix: ${f.suggestion}`);
  return parts.filter(Boolean).join("\n\n");
}

export function commentText(f: Finding, t: TriageEntry | undefined): string {
  return `${labelFor(f)}: ${t?.comment ? t.comment : defaultText(f)}`;
}

function triageOf(r: Review, i: number): TriageEntry | undefined {
  return r.triage?.[String(i)];
}

export function defaultBody(r: Review): string {
  const res = r.result;
  if (!res) return "";
  const lines = [res.summary.trim()];
  if (res.why.trim() && res.why.trim().toLowerCase() !== "unclear") lines.push(`**Why:** ${res.why.trim()}`);
  if (res.ticket) {
    const t = res.ticket;
    const label = t.title ? `${t.id} — ${t.title}` : t.id;
    lines.push(`**Ticket:** ${t.url ? `[${label}](${t.url})` : label}`);
  }
  return lines.join("\n\n");
}

export interface Preview {
  body: string;
  comments: { index: number; path: string; line: number; end_line: number | null; label: string; text: string }[];
  body_items: { index: number; label: string; text: string }[];
  ignored: number;
}

export function buildPreview(r: Review): Preview {
  const out: Preview = { body: defaultBody(r), comments: [], body_items: [], ignored: 0 };
  (r.result?.findings ?? []).forEach((f, index) => {
    const t = triageOf(r, index);
    if (t?.ignored) {
      out.ignored++;
      return;
    }
    const label = labelFor(f);
    const text = commentText(f, t);
    if (f.file && f.line) {
      out.comments.push({ index, path: f.file, line: f.line, end_line: f.end_line, label, text });
    } else {
      out.body_items.push({ index, label, text });
    }
  });
  return out;
}

// ── Triage ──────────────────────────────────────────────────────────────────

function requireDone(r: Review): void {
  if (r.status !== "done" || !r.result) throw new Error("the review is not done yet — triage and publish open once it finishes");
}

/// {id, index, ignored?, comment?} — comment null/"" clears the override.
export function triageFinding(body: any): any {
  const r = requireReview(body?.id);
  requireDone(r);
  if (r.publish?.status === "running") throw new Error("a publish is running — wait for it to finish");
  const index = Number(body?.index);
  const findings = r.result!.findings;
  if (!Number.isInteger(index) || index < 0 || index >= findings.length) {
    throw new Error(`index must be 0..${findings.length - 1}`);
  }
  const t: TriageEntry = { ignored: false, comment: null, ...(triageOf(r, index) ?? {}) };
  if (body?.ignored !== undefined) {
    if (typeof body.ignored !== "boolean") throw new Error("ignored must be true or false");
    t.ignored = body.ignored;
  }
  if (body?.comment !== undefined) {
    if (body.comment !== null && typeof body.comment !== "string") throw new Error("comment must be a string or null");
    const c = typeof body.comment === "string" ? body.comment.trim() : "";
    if (c.length > MAX_COMMENT) throw new Error(`comment is too long (max ${MAX_COMMENT} characters)`);
    t.comment = c || null;
  }
  r.triage = { ...(r.triage ?? {}), [String(index)]: t };
  saveReview(r);
  return { review: publicReview(r) };
}

export function previewFor(id: unknown): Preview {
  const r = requireReview(id);
  requireDone(r);
  return buildPreview(r);
}

// ── Publish ─────────────────────────────────────────────────────────────────

export function publishSystemPrompt(): string {
  return `# PR Review Publisher

You post ONE GitHub pull-request review that a human has already decided on. You do not review code and you do not change the decision, the body or the comments — post them exactly as given.

## Steps
1. In the repository folder, find the open PR for the branch: \`gh pr view <branch> --json number,url,headRefOid,state\` (try \`origin/<branch>\` naming variations only if that fails). Get the repo with \`gh repo view --json nameWithOwner\`. If \`gh\` is missing or not authenticated, or there is no open PR, report failure (step 4) with the exact reason.
2. Write the review payload to a temp file OUTSIDE the repo working tree (\`mktemp\`) as JSON: \`{"event": <EVENT>, "body": <BODY>, "commit_id": <COMMIT>, "comments": [{"path", "line", "side": "RIGHT", "body"} ...]}\` — <COMMIT> is the given \`commit_id\` (the commit that was reviewed, so line numbers match) when present, else \`headRefOid\`; for a multi-line comment add \`"start_line"\` (the first line) and \`"start_side": "RIGHT"\` with \`"line"\` as the last line. Then: \`gh api repos/<owner>/<repo>/pulls/<number>/reviews --method POST --input <file>\`. Delete the temp file afterwards.
3. If GitHub rejects the given \`commit_id\` (e.g. it was force-pushed out of the PR), post again once with \`headRefOid\`. If GitHub rejects inline comments (422, e.g. a line is not part of the diff), move ONLY those comments into the body under a "Comments outside the diff" heading as \`path:line — text\`, and post again. Never drop a comment and never change EVENT. If GitHub refuses the EVENT itself (e.g. you cannot approve your own PR), do NOT fall back to another event — report failure with GitHub's message.
4. Report with \`pr_review_publish_result\`: on success \`{ok: true, pr_url, comments_posted}\` (inline comments actually posted); on failure \`{ok: false, error}\`. Then end your turn.

Never checkout, commit, push, or edit files in the repository.`;
}

export function publishKickoff(r: Review, p: Publish, preview: Preview): string {
  const payload = {
    branch: r.branch,
    commit_id: r.commit || undefined,
    event: DECISION_EVENT[p.decision],
    body:
      p.body +
      (preview.body_items.length
        ? "\n\n---\n\n" + preview.body_items.map((b) => `- ${b.text.replace(/\n+/g, " ")}`).join("\n")
        : ""),
    comments: preview.comments.map((c) => ({
      path: c.path,
      line: c.end_line && c.end_line > c.line ? c.end_line : c.line,
      start_line: c.end_line && c.end_line > c.line ? c.line : undefined,
      body: c.text,
    })),
  };
  return (
    `Publish the human-approved review of branch \`${r.branch}\` (review ${r.id}) as a GitHub PR review.\n` +
    `Decision: ${DECISION_LABEL[p.decision]} — post with event ${payload.event} exactly.\n\n` +
    "Review payload (post exactly; `start_line` only when present):\n```json\n" +
    JSON.stringify(payload, null, 2) +
    "\n```\nFinish with pr_review_publish_result."
  );
}

/// {id, decision, body?} — the decision must be given; it is never inferred.
export function startPublish(body: any, requestedBy: string | null = null): any {
  const r = requireReview(body?.id);
  requireDone(r);
  const decision = str(body?.decision) as Decision;
  if (!DECISIONS.includes(decision)) {
    throw new Error(`decision is required: one of ${DECISIONS.join(", ")} — it is the reviewer's call, not the findings'`);
  }
  if (r.publish?.status === "running") throw new Error("a publish is already running for this review");
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (text.length > MAX_BODY) throw new Error(`body is too long (max ${MAX_BODY} characters)`);
  const preview = buildPreview(r);

  const p: Publish = {
    decision,
    body: text || preview.body,
    status: "running",
    session_id: null,
    pr_url: null,
    error: null,
    comments_posted: null,
    started_at: now(),
    finished_at: null,
    requested_by: requestedBy,
    nudges: 0,
  };
  r.publish = p;
  addLog(r, "done", `publish started: ${DECISION_LABEL[decision]}`);
  saveReview(r);

  const fail = (msg: string) => {
    p.status = "failed";
    p.error = msg;
    p.finished_at = now();
    addLog(r, "done", `publish failed: ${msg}`);
    saveReview(r);
  };
  const name = `Publish PR review: ${r.branch}`;
  let sid: string;
  try {
    if (requestedBy) {
      if (!listFolders().some((f) => f.id === r.folder_id)) throw new Error("the review's folder no longer exists");
      sid = orchestrateCreateSession({
        folder_id: r.folder_id,
        name,
        model: r.model,
        system_prompt: publishSystemPrompt(),
      });
    } else {
      sid = createSession({
        name,
        model: r.model,
        is_temp: false,
        system_prompt: publishSystemPrompt(),
        folder_path: r.folder_path,
        folder_name: r.folder_name,
      });
    }
  } catch (e) {
    fail(`could not create the publish session: ${errMsg(e)}`);
    return { review: publicReview(r) };
  }
  p.session_id = sid;
  storePut(SESSION_INDEX, sid, { review_id: r.id, kind: "publish" });
  try {
    const kick = publishKickoff(r, p, preview);
    if (requestedBy) orchestrateSend(sid, kick);
    else dispatchCapture(sid, kick);
  } catch (e) {
    fail(`the publish session was created but could not be started: ${errMsg(e)}`);
    return { review: publicReview(r) };
  }
  saveReview(r);
  return { review: publicReview(r) };
}

function finishPublish(r: Review, ok: boolean, fields: Partial<Publish>): void {
  const p = r.publish!;
  Object.assign(p, fields);
  p.status = ok ? "posted" : "failed";
  p.finished_at = now();
  addLog(r, "done", ok ? `published: ${DECISION_LABEL[p.decision]}${p.pr_url ? ` — ${p.pr_url}` : ""}` : `publish failed: ${p.error}`);
  saveReview(r);
  if (p.requested_by) {
    try {
      orchestrateSend(
        p.requested_by,
        ok
          ? `[PR review ${r.id}] posted to GitHub — ${DECISION_LABEL[p.decision]}${p.pr_url ? `: ${p.pr_url}` : ""}.`
          : `[PR review ${r.id}] publishing FAILED: ${p.error}. Retry with pr_review_publish.`,
      );
    } catch (_e) {
      // requester gone — the status is on the page
    }
  }
}

/** pr_review_publish_result({ok, pr_url?, comments_posted?, error?}) — publish sessions only. */
export function toolPublishResult(args: any, context: any): any {
  const caller = str(context?.sessionId) || str(context?.session_id);
  const mapping = caller ? storeGet(SESSION_INDEX, caller) : null;
  const r = mapping?.kind === "publish" ? loadReview(str(mapping.review_id)) : null;
  if (!r || r.publish?.session_id !== caller) {
    throw new Error("this tool is reserved for PR review publish sessions");
  }
  if (r.publish.status !== "running") {
    throw new Error(`this publish is already ${r.publish.status} — end your turn`);
  }
  if (typeof args?.ok !== "boolean") throw new Error("ok must be true or false");
  if (args.ok) {
    const url = str(args?.pr_url);
    if (url && !/^https:\/\/\S+$/.test(url)) throw new Error("pr_url must be an https URL");
    const n = args?.comments_posted;
    finishPublish(r, true, {
      pr_url: url || null,
      comments_posted: Number.isInteger(n) && n >= 0 ? n : null,
      error: null,
    });
  } else {
    const err = str(args?.error);
    if (!err) throw new Error("error is required when ok is false");
    finishPublish(r, false, { error: err.slice(0, 1000) });
  }
  return { ok: true, status: r.publish.status, message: "recorded — end your turn" };
}

/// session.agent.ended for a publish session: one nudge, then fail. Returns
/// null when the session is not a publish session (the review watchdog
/// handles it).
export function onPublishEnded(payload: any): any {
  const sid = str(payload?.session_id);
  const mapping = sid ? storeGet(SESSION_INDEX, sid) : null;
  if (mapping?.kind !== "publish") return null;
  const r = loadReview(str(mapping.review_id));
  const p = r?.publish;
  if (!r || !p || p.session_id !== sid || p.status !== "running") return { ok: true };
  const nudges = p.nudges ?? 0;
  if (nudges >= MAX_PUBLISH_NUDGES) {
    finishPublish(r, false, { error: "the publish session ended without reporting a result" });
    return { ok: true, failed: true };
  }
  p.nudges = nudges + 1;
  saveReview(r);
  try {
    orchestrateSend(
      sid,
      "[PR review publish watchdog] Your run ended without calling pr_review_publish_result. " +
        "If the review was posted, report it now; otherwise finish posting or report the failure.",
    );
  } catch (e) {
    finishPublish(r, false, { error: `the publish session stopped and could not be resumed: ${errMsg(e)}` });
  }
  return { ok: true, nudged: true };
}

// ── Session-facing tools ────────────────────────────────────────────────────

/** pr_review_triage({id, index, ignored?, comment?}) — returns the updated preview. */
export function toolTriage(args: any, context: any): any {
  assertNotReviewSession(context);
  triageFinding(args);
  return { ok: true, preview: previewFor(args?.id) };
}

/** pr_review_publish({id, decision, body?}) — decision is required, never inferred. */
export function toolPublish(args: any, context: any): any {
  const caller = assertNotReviewSession(context);
  const out = startPublish(args, caller || null);
  const p = out.review.publish;
  if (p?.status === "failed") throw new Error(p.error ?? "publishing could not start");
  return {
    ok: true,
    publish: p,
    message: caller
      ? "Publishing started. You will get a message here when it is posted or fails."
      : "Publishing started. Poll pr_review_get for the publish status.",
  };
}
