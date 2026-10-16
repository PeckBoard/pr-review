// Pure helpers for the PR review page — no DOM, unit-tested in
// test/page.test.ts. Everything that formats, groups, or validates review
// data lives here so main.js stays about rendering.

export const STEPS = ["starting", "context", "reviewing", "merging", "verifying", "submitting", "done"];

export const STEP_LABELS = {
  starting: "Starting",
  context: "Gathering context",
  reviewing: "Reviewing",
  merging: "Merging findings",
  verifying: "Verifying",
  submitting: "Submitting",
  done: "Done",
};

export const STATUS_LABELS = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const VERDICT_LABELS = {
  approve: "Approve",
  approve_with_comments: "Approve with comments",
  request_changes: "Request changes",
};

export const SEVERITIES = ["blocker", "major", "minor", "nit"];

export const SEVERITY_LABELS = {
  blocker: "Blocker",
  major: "Major",
  minor: "Minor",
  nit: "Nit",
};

/** A review still doing work — drives the fast poll and the Cancel action. */
export function isActive(review) {
  return !!review && (review.status === "queued" || review.status === "running");
}

/** Timestamp → epoch ms. Accepts ISO strings, epoch seconds, or epoch ms. */
export function toMs(t) {
  if (t === null || t === undefined || t === "") return null;
  if (typeof t === "number") return t < 1e12 ? t * 1000 : t;
  if (typeof t === "string" && /^\d+$/.test(t)) return toMs(Number(t));
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : ms;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "just now" / "5m ago" / "3h ago" / "2d ago" / "Oct 3". */
export function relTime(ms, now) {
  if (ms === null || ms === undefined) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.round(h / 24);
  if (d < 7) return d + "d ago";
  const dt = new Date(ms);
  return MONTHS[dt.getMonth()] + " " + dt.getDate();
}

/** Compact duration: "42s", "3m 05s", "1h 12m". */
export function duration(ms) {
  if (ms === null || ms === undefined || ms < 0) return "";
  const total = Math.floor(ms / 1000);
  if (total < 60) return total + "s";
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return m + "m " + String(s).padStart(2, "0") + "s";
  const h = Math.floor(m / 60);
  return h + "h " + String(m % 60).padStart(2, "0") + "m";
}

/** Wall time a review took (finished) or has taken so far (still active). */
export function elapsedMs(review, now) {
  const start = toMs(review.created_at);
  if (start === null) return null;
  const end = toMs(review.finished_at);
  if (end !== null) return end - start;
  return isActive(review) ? now - start : null;
}

/** Per-step state for the stepper: done | active | failed | cancelled | pending. */
export function stepStates(review) {
  const cur = Math.max(0, STEPS.indexOf(review.step));
  return STEPS.map((_s, i) => {
    if (review.status === "done") return "done";
    if (i < cur) return "done";
    if (i > cur) return "pending";
    if (review.status === "failed") return "failed";
    if (review.status === "cancelled") return "cancelled";
    if (review.status === "queued") return "pending";
    return "active";
  });
}

/** One-line progress caption under the stepper. */
export function progressCaption(review) {
  const label = STEP_LABELS[review.step] || review.step || "";
  const idx = STEPS.indexOf(review.step);
  switch (review.status) {
    case "queued":
      return "Waiting to start";
    case "running":
      return idx >= 0 ? label + " · step " + (idx + 1) + " of " + STEPS.length : label;
    case "done":
      return "Finished";
    case "failed":
      return label ? "Failed while " + label.toLowerCase() : "Failed";
    case "cancelled":
      return label ? "Cancelled while " + label.toLowerCase() : "Cancelled";
    default:
      return label;
  }
}

/** Models grouped by provider, order preserved: [[provider, models[]], …]. */
export function groupModels(models) {
  const groups = new Map();
  for (const m of models || []) {
    const p = m.provider || (m.id && m.id.includes(":") ? m.id.split(":")[0] : "other");
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(m);
  }
  return Array.from(groups.entries());
}

export function providerLabel(p) {
  if (!p) return "";
  return p.charAt(0).toUpperCase() + p.slice(1);
}

/** Display name for a model id, falling back to the id without its prefix. */
export function modelName(models, id) {
  if (!id) return "";
  const m = (models || []).find((x) => x.id === id);
  if (m && m.display_name) return m.display_name;
  return id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
}

/** Folders matching every whitespace-separated token in name or path;
 * name-prefix matches first. */
export function filterFolders(folders, query) {
  const list = folders || [];
  const tokens = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return list.slice();
  const hits = list.filter((f) => {
    const hay = ((f.name || "") + " " + (f.path || "")).toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
  const first = tokens[0];
  return hits.sort((a, b) => {
    const ap = (a.name || "").toLowerCase().startsWith(first) ? 0 : 1;
    const bp = (b.name || "").toLowerCase().startsWith(first) ? 0 : 1;
    return ap - bp;
  });
}

/** Field-level errors for the new-review form; empty object = valid. */
export function validateStart(values, folders) {
  const errors = {};
  const branch = (values.branch || "").trim();
  const base = (values.base || "").trim();
  if (!branch) errors.branch = "Enter the branch to review.";
  else if (/\s/.test(branch)) errors.branch = "Branch names can't contain spaces.";
  if (base && /\s/.test(base)) errors.base = "Branch names can't contain spaces.";
  if (!values.folder_id) errors.folder_id = "Pick the folder that holds the repository.";
  else if (folders && !folders.some((f) => f.id === values.folder_id))
    errors.folder_id = "That folder no longer exists — pick another.";
  return errors;
}

/** Why Start is disabled, as one sentence (null when it isn't). */
export function startBlockReason(errors) {
  const missing = [];
  if (errors.branch === "Enter the branch to review.") missing.push("a branch");
  if (errors.folder_id === "Pick the folder that holds the repository.") missing.push("a target folder");
  if (missing.length) return "Needs " + missing.join(" and ") + ".";
  const first = errors.branch || errors.base || errors.folder_id;
  return first || null;
}

/** Which form field a server error message is about (null = whole form). */
export function fieldForError(msg) {
  const m = String(msg || "").toLowerCase();
  if (/\bbase\b/.test(m)) return "base";
  if (/\bbranch\b/.test(m)) return "branch";
  if (/\bfolder\b|\brepo(sitory)?\b/.test(m)) return "folder_id";
  if (/\bmodel\b/.test(m)) return "model";
  return null;
}

/** Findings bucketed by severity (+ praise), each sorted by agreement and
 * confidence so the most corroborated item leads its group. */
export function groupFindings(findings) {
  const out = { blocker: [], major: [], minor: [], nit: [], praise: [] };
  for (const f of findings || []) {
    if (f.kind === "praise") out.praise.push(f);
    else out[SEVERITIES.includes(f.severity) ? f.severity : "minor"].push(f);
  }
  const rank = (a, b) =>
    (b.reviewers || []).length - (a.reviewers || []).length || (b.confidence || 0) - (a.confidence || 0);
  for (const k of Object.keys(out)) out[k].sort(rank);
  return out;
}

/** "src/a.ts:12–18", "src/a.ts:12", "src/a.ts", or null. */
export function formatLocation(f) {
  if (!f || !f.file) return null;
  if (!f.line) return f.file;
  const range = f.end_line && f.end_line !== f.line ? f.line + "–" + f.end_line : String(f.line);
  return f.file + ":" + range;
}

/** Only http(s) URLs may become links. */
export function safeUrl(u) {
  return typeof u === "string" && /^https?:\/\/[^\s"<>]+$/i.test(u) ? u : null;
}

export function confidenceLevel(c) {
  const v = typeof c === "number" ? c : 0;
  if (v >= 0.75) return "high";
  if (v >= 0.5) return "medium";
  return "low";
}
