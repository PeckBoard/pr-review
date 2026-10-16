// The review state machine: page actions (start / rerun / cancel / delete /
// settings), the agent-facing tools (pr_review_step / pr_review_submit), and
// the `session.agent.ended` watchdog.
//
//   start ──► queued ──dispatch──► running ──submit──► done
//                 │                   │  ├─cancel──► cancelled
//                 └─dispatch fails──► failed ◄── abort_reason / watchdog gives up
//
// Storage (plugin document store):
//   reviews/<id>          the Review document
//   session_index/<sid>   {review_id} — how a tool call / ended hook finds
//                         its review from the calling session's id
//   settings/global       {global_prompt}

import {
  createSession,
  dispatchCapture,
  Folder,
  listFolders,
  listModels,
  ModelChoice,
  orchestrateCreateSession,
  orchestrateSend,
  orchestrateTerminate,
  sessionExists,
  storeDelete,
  storeGet,
  storeList,
  storePut,
} from "./host";
import { buildSystemPrompt, DEFAULT_GLOBAL_PROMPT, kickoffMessage, nudgeMessage } from "./prompt";
import {
  DEFAULT_PROVIDERS,
  PROVIDER_STATUSES,
  ProviderStatus,
  Review,
  STEPS,
  Step,
} from "./types";
import { countFindings, emptyCounts, validateResult } from "./validate";
import { errMsg } from "./verdict";

export const REVIEWS = "reviews";
export const SESSION_INDEX = "session_index";
export const SETTINGS = "settings";
const SETTINGS_KEY = "global";

/// Consecutive runs that may end without progress before the review fails.
export const MAX_NUDGES = 2;
const MAX_LOG = 200;
const MAX_CUSTOM_PROMPT = 20_000;
const MAX_GLOBAL_PROMPT = 60_000;
const MAX_NOTE = 500;

// ── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  const rand = Math.floor(Math.random() * 0xffffffff)
    .toString(36)
    .padStart(7, "0");
  return `r${Date.now().toString(36)}${rand}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// A git ref name the agent will paste into shell commands — keep it to the
// characters real branch names use, so a crafted name cannot smuggle a
// command or a prompt break.
const REF_RE = /^[A-Za-z0-9._\/@+-]+$/;

function validateRef(label: string, ref: string): void {
  if (!REF_RE.test(ref) || ref.startsWith("-") || ref.includes("..") || ref.length > 200) {
    throw new Error(
      `${label} '${ref}' is not a valid branch name (letters, digits, . _ / @ + - only)`,
    );
  }
}

function isActive(r: Review): boolean {
  return r.status === "queued" || r.status === "running";
}

function loadReview(id: string): Review | null {
  if (!id) return null;
  const r = storeGet(REVIEWS, id);
  return r && typeof r === "object" ? (r as Review) : null;
}

function saveReview(r: Review): void {
  r.updated_at = now();
  storePut(REVIEWS, r.id, r);
}

function requireReview(id: unknown): Review {
  const r = loadReview(str(id));
  if (!r) throw new Error("review not found");
  return r;
}

function addLog(r: Review, step: Step, note: string): void {
  r.log.push({ at: now(), step, note: note.slice(0, MAX_NOTE) });
  if (r.log.length > MAX_LOG) r.log.splice(0, r.log.length - MAX_LOG);
}

function finish(r: Review, status: "done" | "failed" | "cancelled", error: string | null): void {
  const wasRunning = r.status === "running";
  r.status = status;
  r.error = error;
  r.finished_at = now();
  if (status === "done") r.step = "done";
  // A session that started this review via pr_review_start hears how it
  // ended. Launch failures are excluded — the tool call already returned them.
  if (wasRunning && status !== "cancelled" && r.notify && r.requested_by) {
    try {
      orchestrateSend(r.requested_by, finishedMessage(r));
    } catch (_e) {
      // requester gone — the result is still on the page and in pr_review_get
    }
  }
}

/// The message a requesting session receives when its review ends.
export function finishedMessage(r: Review): string {
  const head = `[PR review ${r.id}] \`${r.branch}\` in ${r.folder_name}`;
  if (r.status !== "done" || !r.result) {
    return `${head} FAILED: ${r.error ?? "unknown error"}. Re-run it with pr_review_rerun.`;
  }
  const c = r.counts;
  const changes = r.result.findings
    .filter((f) => f.kind === "change")
    .slice(0, 10)
    .map((f) => `- [${f.severity}] ${f.title}${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ""})` : ""}`);
  return (
    `${head} finished — verdict: ${r.result.verdict}; ` +
    `${c.blocker} blocker, ${c.major} major, ${c.minor} minor, ${c.nit} nit, ${c.praise} praise.\n\n` +
    `${r.result.summary}\n` +
    (changes.length ? `\n${changes.join("\n")}\n` : "") +
    `\nFull result: pr_review_get({"id": "${r.id}"}).`
  );
}

/// Route view of a review: the full document minus internal fields.
export function publicReview(r: Review): Omit<Review, "nudges"> {
  const { nudges: _n, ...rest } = r;
  return rest;
}

/// List view: no log, no result — but the verdict, so rows can show it.
export function summaryOf(r: Review): any {
  const { log: _l, result: _r, nudges: _n, ...rest } = r;
  return { ...rest, verdict: r.result?.verdict ?? null };
}

// ── Models / settings ───────────────────────────────────────────────────────

function safeModels(): ModelChoice[] {
  try {
    return listModels();
  } catch (_e) {
    return [];
  }
}

/// The highest-capability claude model (tiers ascend in capability), opus
/// preferred, account-less ids before per-account variants; else the first.
export function pickDefaultModel(models: ModelChoice[]): string {
  if (models.length === 0) return "";
  const claude = models.filter((m) => m.provider === "claude");
  if (claude.length === 0) return models[0].id;
  const score = (m: ModelChoice) =>
    (typeof m.tier === "number" ? m.tier : 0) * 4 +
    (/opus/i.test(m.id) ? 2 : 0) +
    (m.account_id ? 0 : 1);
  return claude.reduce((best, m) => (score(m) > score(best) ? m : best)).id;
}

export function globalPrompt(): string {
  const s = storeGet(SETTINGS, SETTINGS_KEY);
  const p = typeof s?.global_prompt === "string" ? s.global_prompt : "";
  return p.trim() ? p : DEFAULT_GLOBAL_PROMPT;
}

function settingsView(models: ModelChoice[]): any {
  return {
    global_prompt: globalPrompt(),
    default_global_prompt: DEFAULT_GLOBAL_PROMPT,
    default_model: pickDefaultModel(models),
  };
}

export function saveSettings(body: any): any {
  const raw = typeof body?.global_prompt === "string" ? body.global_prompt : null;
  if (raw === null) throw new Error("global_prompt must be a string");
  if (raw.length > MAX_GLOBAL_PROMPT) {
    throw new Error(`global_prompt is too long (max ${MAX_GLOBAL_PROMPT} characters)`);
  }
  if (!raw.trim() || raw.trim() === DEFAULT_GLOBAL_PROMPT.trim()) {
    storeDelete(SETTINGS, SETTINGS_KEY);
  } else {
    storePut(SETTINGS, SETTINGS_KEY, { global_prompt: raw });
  }
  return { settings: settingsView(safeModels()) };
}

// ── Page routes ─────────────────────────────────────────────────────────────

function allReviews(): Review[] {
  return storeList(REVIEWS)
    .map((it) => it.value as Review)
    .filter((r) => r && typeof r === "object" && typeof r.id === "string");
}

/// GET state. Also self-heals reviews whose session was deleted mid-run.
export function pageState(): any {
  const reviews = allReviews().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const active = reviews.filter((r) => isActive(r) && r.session_id);
  if (active.length > 0) {
    for (const r of active) {
      let exists = true;
      try {
        exists = sessionExists(r.session_id as string);
      } catch (_e) {
        // unreadable listing: leave it, the next poll retries
      }
      if (!exists) {
        finish(r, "failed", "the review session was deleted before the review finished");
        saveReview(r);
      }
    }
  }
  let folders: Folder[] = [];
  try {
    folders = listFolders();
  } catch (_e) {
    folders = [];
  }
  const models = safeModels();
  return {
    reviews: reviews.map(summaryOf),
    folders: folders.map((f) => ({ id: f.id, name: f.name, path: f.path })),
    models: models.map((m) => ({ id: m.id, display_name: m.display_name, provider: m.provider })),
    settings: settingsView(models),
  };
}

export function getReview(id: unknown): any {
  return { review: publicReview(requireReview(id)) };
}

interface StartInput {
  branch: string;
  base: string | null;
  folder: Folder;
  model: string;
  prompt: string;
  /// Set when a session started the review via `pr_review_start`.
  requestedBy?: string | null;
  notify?: boolean;
}

function launch(input: StartInput): Review {
  const ts = now();
  const fromTool = !!input.requestedBy;
  const review: Review = {
    id: newId(),
    branch: input.branch,
    base: input.base,
    folder_id: input.folder.id,
    folder_name: input.folder.name,
    folder_path: input.folder.path,
    model: input.model,
    custom_prompt: input.prompt,
    session_id: null,
    status: "queued",
    step: "starting",
    log: [],
    providers: Object.fromEntries(DEFAULT_PROVIDERS.map((p) => [p, "pending" as ProviderStatus])),
    counts: emptyCounts(),
    created_at: ts,
    updated_at: ts,
    finished_at: null,
    error: null,
    result: null,
    requested_by: input.requestedBy ?? null,
    notify: !!input.notify,
    nudges: 0,
  };
  addLog(review, "starting", fromTool ? "review queued by a session" : "review queued");
  saveReview(review);

  const name = `PR review: ${input.branch}`;
  const systemPrompt = buildSystemPrompt(review, globalPrompt());
  let sessionId: string;
  try {
    // A tool call's create_session is pinned to the caller's folder; the
    // orchestrate twin takes the target folder explicitly.
    sessionId = fromTool
      ? orchestrateCreateSession({
          folder_id: input.folder.id,
          name,
          model: input.model,
          system_prompt: systemPrompt,
        })
      : createSession({
          name,
          model: input.model,
          is_temp: false,
          system_prompt: systemPrompt,
          folder_path: input.folder.path,
          folder_name: input.folder.name,
        });
  } catch (e) {
    finish(review, "failed", `could not create the review session: ${errMsg(e)}`);
    saveReview(review);
    return review;
  }
  review.session_id = sessionId;
  storePut(SESSION_INDEX, sessionId, { review_id: review.id });

  try {
    if (fromTool) orchestrateSend(sessionId, kickoffMessage(review));
    else dispatchCapture(sessionId, kickoffMessage(review));
  } catch (e) {
    finish(review, "failed", `the review session was created but could not be started: ${errMsg(e)}`);
    saveReview(review);
    return review;
  }
  review.status = "running";
  addLog(review, "starting", "review session started");
  saveReview(review);
  return review;
}

/// POST start {branch, base?, folder_id, model?, prompt?}.
export function startReview(body: any): any {
  const branch = str(body?.branch);
  if (!branch) throw new Error("branch is required");
  validateRef("branch", branch);
  const base = str(body?.base) || null;
  if (base) validateRef("base", base);
  const folderId = str(body?.folder_id);
  if (!folderId) throw new Error("folder_id is required");
  const folder = listFolders().find((f) => f.id === folderId);
  if (!folder) throw new Error("folder not found");
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length > MAX_CUSTOM_PROMPT) {
    throw new Error(`prompt is too long (max ${MAX_CUSTOM_PROMPT} characters)`);
  }
  let model = str(body?.model);
  if (!model) model = pickDefaultModel(safeModels());
  if (!model) throw new Error("no model is available — enable a provider first");
  return { review: publicReview(launch({ branch, base, folder, model, prompt })) };
}

/// POST rerun {id} — a NEW review (fresh session) with the same inputs; the
/// old one keeps its result.
export function rerunReview(body: any): any {
  const prior = requireReview(body?.id);
  const folder = listFolders().find((f) => f.id === prior.folder_id) ?? {
    id: prior.folder_id,
    name: prior.folder_name,
    path: prior.folder_path,
  };
  return {
    review: publicReview(
      launch({
        branch: prior.branch,
        base: prior.base,
        folder,
        model: prior.model,
        prompt: prior.custom_prompt,
      }),
    ),
  };
}

function stopSession(r: Review): void {
  if (!r.session_id) return;
  try {
    orchestrateTerminate(r.session_id);
  } catch (_e) {
    // no running agent / session gone — nothing to stop
  }
}

/// POST cancel {id}.
export function cancelReview(body: any): any {
  const r = requireReview(body?.id);
  if (isActive(r)) {
    finish(r, "cancelled", null);
    addLog(r, r.step, "cancelled by the user");
    saveReview(r);
    stopSession(r);
  }
  return { ok: true };
}

/// POST delete {id}. The session itself stays — it is the user's transcript.
export function deleteReview(body: any): any {
  const r = requireReview(body?.id);
  if (isActive(r)) stopSession(r);
  if (r.session_id) storeDelete(SESSION_INDEX, r.session_id);
  storeDelete(REVIEWS, r.id);
  return { ok: true };
}

// ── Agent-facing tools ──────────────────────────────────────────────────────

/** Resolve a tool call to ITS review via the calling session's id. The
 * context arrives camelCase from core; snake_case accepted defensively. */
export function reviewForCaller(context: any): Review {
  const caller = str(context?.sessionId) || str(context?.session_id);
  if (!caller) throw new Error("this tool only works from a PR review session");
  const mapping = storeGet(SESSION_INDEX, caller);
  const review = loadReview(str(mapping?.review_id));
  if (!review || review.session_id !== caller) {
    throw new Error(
      "this tool is reserved for PR review sessions — start a review from the PR Reviews page",
    );
  }
  if (!isActive(review)) {
    throw new Error(
      `review ${review.id} is ${review.status} — stop working on it and end your turn`,
    );
  }
  return review;
}

/** pr_review_step({step, note?, provider?, provider_status?, abort_reason?}) */
export function toolStep(args: any, context: any): any {
  const r = reviewForCaller(context);
  const step = str(args?.step) as Step;
  if (!STEPS.includes(step) || step === "done") {
    throw new Error(
      `step must be one of ${STEPS.filter((s) => s !== "done").join(", ")} (a successful pr_review_submit marks the review done)`,
    );
  }
  const provider = str(args?.provider).toLowerCase();
  const pstatus = str(args?.provider_status) as ProviderStatus;
  if (provider && !PROVIDER_STATUSES.includes(pstatus)) {
    throw new Error(`provider_status must be one of ${PROVIDER_STATUSES.join(", ")} when provider is given`);
  }
  if (!provider && pstatus) throw new Error("provider_status needs provider");
  if (provider && !/^[a-z0-9_-]{1,40}$/.test(provider)) {
    throw new Error("provider must be a short provider id, e.g. claude, codex, grok");
  }

  r.status = "running";
  r.step = step;
  r.nudges = 0; // progress resets the watchdog
  const note = str(args?.note);
  if (provider) {
    r.providers[provider] = pstatus;
    addLog(r, step, `${provider}: ${pstatus}${note ? ` — ${note}` : ""}`);
  } else {
    addLog(r, step, note || `step: ${step}`);
  }
  const abort = str(args?.abort_reason);
  if (abort) {
    finish(r, "failed", abort.slice(0, MAX_NOTE));
    addLog(r, step, `aborted: ${abort}`);
    saveReview(r);
    return { ok: true, status: "failed", message: "review marked failed — end your turn" };
  }
  saveReview(r);
  return { ok: true, review_id: r.id, step };
}

/** pr_review_submit({result}) */
export function toolSubmit(args: any, context: any): any {
  const r = reviewForCaller(context);
  const v = validateResult(args?.result);
  if (!v.ok) {
    return {
      error:
        "result rejected — fix these and call pr_review_submit again:\n- " + v.errors.join("\n- "),
    };
  }
  const result = v.result;
  r.result = result;
  r.counts = countFindings(result.findings);
  const failed = new Set(result.reviewers_failed.map((p) => p.toLowerCase()));
  for (const p of failed) r.providers[p] = "failed";
  for (const [p, s] of Object.entries(r.providers)) {
    if (!failed.has(p) && (s === "pending" || s === "running")) r.providers[p] = "done";
  }
  finish(r, "done", null);
  addLog(
    r,
    "done",
    `submitted: ${result.verdict}, ${result.findings.length} finding(s)`,
  );
  saveReview(r);
  return {
    ok: true,
    review_id: r.id,
    counts: r.counts,
    message: "review saved — remove the worktree if you have not, then end your turn",
  };
}

// ── Watchdog (session.agent.ended) ──────────────────────────────────────────

/// A review session's run ended. If no result was submitted, nudge it to
/// continue (up to MAX_NUDGES consecutive runs without progress), then fail
/// the review with an explicit error. A run that ends while reviewer
/// subagents are still `running` is the expected wait — their results wake
/// the session — so it is neither nudged nor counted.
export function onAgentEnded(payload: any): any {
  const sid = str(payload?.session_id);
  if (!sid) return { ok: true };
  const mapping = storeGet(SESSION_INDEX, sid);
  const r = loadReview(str(mapping?.review_id));
  if (!r || r.session_id !== sid || !isActive(r)) return { ok: true };

  const outcome = str(payload?.outcome) || "completed";
  const reason = str(payload?.reason);
  const waiting = Object.values(r.providers).some((s) => s === "running");
  if (waiting && outcome === "completed") {
    addLog(r, r.step, "session idle — waiting for reviewer subagents");
    saveReview(r);
    return { ok: true, waiting: true };
  }

  const nudges = r.nudges ?? 0;
  if (nudges >= MAX_NUDGES) {
    finish(
      r,
      "failed",
      `the review session ended ${nudges + 1} runs in a row without submitting a result ` +
        `(pr_review_submit)${reason ? ` — last run: ${outcome}: ${reason}` : ""}`,
    );
    addLog(r, r.step, "watchdog: gave up");
    saveReview(r);
    return { ok: true, failed: true };
  }
  r.nudges = nudges + 1;
  addLog(
    r,
    r.step,
    `watchdog: run ended (${outcome}${reason ? `: ${reason}` : ""}) without a result — nudge ${r.nudges}/${MAX_NUDGES}`,
  );
  try {
    orchestrateSend(sid, nudgeMessage(r, r.nudges, MAX_NUDGES));
  } catch (e) {
    finish(r, "failed", `the review session stopped and could not be resumed: ${errMsg(e)}`);
  }
  saveReview(r);
  return { ok: true, nudged: r.status === "running" };
}

// ── Session-facing tools (start / inspect / control reviews) ────────────────
// Any session may drive reviews the same way the page does. A PR review
// session itself may not — it would recurse into reviews of reviews.

function callerSession(context: any): string {
  return str(context?.sessionId) || str(context?.session_id);
}

function assertNotReviewSession(context: any): string {
  const caller = callerSession(context);
  if (caller && storeGet(SESSION_INDEX, caller)) {
    throw new Error("a PR review session cannot start or manage other reviews");
  }
  return caller;
}

/// Folder for a tool-started review: folder_id, else a folder name/path,
/// else the calling session's own folder.
function resolveFolder(args: any, context: any): Folder {
  const folders = listFolders();
  const id = str(args?.folder_id);
  if (id) {
    const f = folders.find((x) => x.id === id);
    if (!f) throw new Error(`folder not found: ${id} (call pr_review_list_folders)`);
    return f;
  }
  const named = str(args?.folder);
  if (named) {
    const hits = folders.filter((x) => x.name === named || x.path === named);
    if (hits.length === 1) return hits[0];
    throw new Error(
      hits.length
        ? `folder '${named}' is ambiguous — pass folder_id (call pr_review_list_folders)`
        : `no folder named '${named}' (call pr_review_list_folders)`,
    );
  }
  const own = str(context?.folderId) || str(context?.folder_id);
  const f = own ? folders.find((x) => x.id === own) : undefined;
  if (!f) throw new Error("pass folder_id — this session has no folder to default to");
  return f;
}

function pageUrl(r: Review): string {
  return `/plugin-page/pr-review/pr-review#/review/${r.id}`;
}

/** pr_review_start({branch, base?, folder_id?, folder?, model?, prompt?, notify?}) */
export function toolStart(args: any, context: any): any {
  const caller = assertNotReviewSession(context);
  const branch = str(args?.branch);
  if (!branch) throw new Error("branch is required");
  validateRef("branch", branch);
  const base = str(args?.base) || null;
  if (base) validateRef("base", base);
  const folder = resolveFolder(args, context);
  const prompt = typeof args?.prompt === "string" ? args.prompt.trim() : "";
  if (prompt.length > MAX_CUSTOM_PROMPT) {
    throw new Error(`prompt is too long (max ${MAX_CUSTOM_PROMPT} characters)`);
  }
  const models = safeModels();
  let model = str(args?.model);
  if (model && !models.some((m) => m.id === model)) {
    throw new Error(`unknown or non-thinking model '${model}' — omit it to use the default`);
  }
  if (!model) model = pickDefaultModel(models);
  if (!model) throw new Error("no model is available — enable a provider first");
  const notify = args?.notify !== false && !!caller;
  const r = launch({ branch, base, folder, model, prompt, requestedBy: caller || null, notify });
  if (r.status === "failed") throw new Error(r.error ?? "the review could not be started");
  return {
    review: summaryOf(r),
    page: pageUrl(r),
    message: notify
      ? "Review started. You will get a message in this session when it finishes; " +
        "use pr_review_get for progress meanwhile."
      : "Review started. Poll pr_review_get for progress and the result.",
  };
}

/** pr_review_list({status?, folder_id?, limit?}) */
export function toolList(args: any, context: any): any {
  assertNotReviewSession(context);
  const status = str(args?.status);
  const folderId = str(args?.folder_id);
  const limit = Math.min(Math.max(Number(args?.limit) || 20, 1), 100);
  const reviews = allReviews()
    .filter((r) => (!status || r.status === status) && (!folderId || r.folder_id === folderId))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { total: reviews.length, reviews: reviews.slice(0, limit).map(summaryOf) };
}

/** pr_review_get({id}) — the full review incl. its result and activity log. */
export function toolGet(args: any, context: any): any {
  assertNotReviewSession(context);
  const r = requireReview(args?.id);
  return { review: publicReview(r), page: pageUrl(r) };
}

/** pr_review_rerun({id, notify?}) — a new review with the same inputs. */
export function toolRerun(args: any, context: any): any {
  const caller = assertNotReviewSession(context);
  const prior = requireReview(args?.id);
  const folder = listFolders().find((f) => f.id === prior.folder_id);
  if (!folder) throw new Error("the review's folder no longer exists");
  const notify = args?.notify !== false && !!caller;
  const r = launch({
    branch: prior.branch,
    base: prior.base,
    folder,
    model: prior.model,
    prompt: prior.custom_prompt,
    requestedBy: caller || null,
    notify,
  });
  if (r.status === "failed") throw new Error(r.error ?? "the review could not be started");
  return { review: summaryOf(r), page: pageUrl(r) };
}

export function toolCancel(args: any, context: any): any {
  assertNotReviewSession(context);
  return cancelReview(args);
}

export function toolDelete(args: any, context: any): any {
  assertNotReviewSession(context);
  return deleteReview(args);
}

/** pr_review_list_folders — folders a review can target. */
export function toolListFolders(_args: any, context: any): any {
  assertNotReviewSession(context);
  const own = str(context?.folderId) || str(context?.folder_id);
  return {
    folders: listFolders().map((f) => ({ id: f.id, name: f.name, path: f.path, current: f.id === own })),
  };
}

/** pr_review_get_prompt — the global prompt (and whether it is the default). */
export function toolGetPrompt(_args: any, context: any): any {
  assertNotReviewSession(context);
  const p = globalPrompt();
  return { global_prompt: p, is_default: p === DEFAULT_GLOBAL_PROMPT };
}

/** pr_review_set_prompt({global_prompt}) — empty string restores the default. */
export function toolSetPrompt(args: any, context: any): any {
  assertNotReviewSession(context);
  saveSettings({ global_prompt: typeof args?.global_prompt === "string" ? args.global_prompt : "" });
  const p = globalPrompt();
  return { ok: true, is_default: p === DEFAULT_GLOBAL_PROMPT, length: p.length };
}