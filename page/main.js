// PR review page. Runs inside PeckBoard's sandboxed plugin iframe (opaque
// origin, no auth token) — all data flows through the parent-proxied
// postMessage fetch bridge (see peckboard/web/src/components/PluginFullPage.tsx).
//
// Hash routes: `#/` review list, `#/prompt` global prompt editor,
// `#/review/<id>` review detail. All user/agent strings are rendered with
// textContent; long-form review text goes through the escape-first
// markdown renderer in md.js (the only innerHTML sink besides static icons).

import { CSS } from "./style.js";
import { inlineMarkdown, markdownToHtml } from "./md.js";
import {
  DECISIONS,
  DECISION_DONE,
  DECISION_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  STATUS_LABELS,
  STEPS,
  STEP_LABELS,
  VERDICT_LABELS,
  confidenceLevel,
  defaultComment,
  duration,
  elapsedMs,
  fieldForError,
  filterFolders,
  formatLocation,
  groupFindings,
  groupModels,
  isActive,
  modelName,
  pollsFast,
  previewCaption,
  progressCaption,
  providerLabel,
  publishBlockReason,
  publishChip,
  publishRunning,
  relTime,
  safeUrl,
  splitTriage,
  startBlockReason,
  stepStates,
  toMs,
  triageEntry,
  validateStart,
} from "./util.js";

const P = "/api/plugin-ui/pr-review";
const POLL_ACTIVE_MS = 3000;
const POLL_IDLE_MS = 15000;

// ── theme ────────────────────────────────────────────────────────────────────

const mediaDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
(function stampTheme() {
  const q = new URLSearchParams(window.location.search).get("theme");
  const theme = q === "dark" || q === "light" ? q : mediaDark && mediaDark.matches ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
})();

// ── parent-proxied fetch bridge ──────────────────────────────────────────────

const pending = new Map();
let seq = 0;
let eventTimer = null;
window.addEventListener("message", (e) => {
  const m = e.data;
  if (!m) return;
  if (m.type === "plugin-ui-fetch-result" && pending.has(m.requestId)) {
    const cb = pending.get(m.requestId);
    pending.delete(m.requestId);
    cb(m);
  } else if (m.type === "plugin-ui-event" && m.event === "plugin-data") {
    // The host forwards "your data changed" pings — refresh now instead of
    // waiting for the next poll (debounced: writes arrive in bursts).
    clearTimeout(eventTimer);
    eventTimer = setTimeout(refresh, 250);
  }
});

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const requestId = ++seq;
    pending.set(requestId, (m) => {
      let data = null;
      try {
        data = m.body ? JSON.parse(m.body) : null;
      } catch (_e) {
        // non-JSON error body; fall through to the status check
      }
      if (m.status >= 200 && m.status < 300) resolve(data || {});
      else reject(new Error((data && data.error) || "request failed (HTTP " + m.status + ")"));
    });
    parent.postMessage(
      {
        type: "plugin-ui-fetch",
        requestId,
        method,
        path,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      "*",
    );
  });
}
const getJSON = (path) => api("GET", path);
const postJSON = (path, body) => api("POST", path, body || {});

// Ask the host app to open a session tab. The iframe cannot navigate the app
// itself (opaque origin, and a target=_blank tab would inherit the sandbox);
// PluginFullPage re-dispatches this as `peckboard:open-session`.
function openSession(id) {
  if (!id) return;
  parent.postMessage({ type: "plugin-ui-open-session", sessionId: String(id) }, "*");
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function h(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const k of Object.keys(props)) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k === "html")
        n.innerHTML = v; // escape-first markdown output only
      else if (k === "testid") n.setAttribute("data-testid", v);
      else if (k === "value") n.value = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : String(v));
    }
  }
  append(n, kids);
  return n;
}
function append(n, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
  }
  return n;
}
function clear(n) {
  while (n.firstChild) n.removeChild(n.firstChild);
  return n;
}

// Static, trusted markup only (lucide icon paths) — data never goes here.
const ICONS = {
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  prompt:
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  session: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  rerun: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  stop: '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  trash:
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  folder:
    '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  alert:
    '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  chevRight: '<path d="m9 18 6-6-6-6"/>',
  chevDown: '<path d="m6 9 6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  timer: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/>',
  loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  users:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
  bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  external:
    '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  pr: '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/>',
  comment: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  pencil:
    '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  eye: '<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
  eyeOff:
    '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
  send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
};
function icon(name, extra) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none");
  s.setAttribute("stroke", "currentColor");
  s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round");
  s.setAttribute("stroke-linejoin", "round");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("class", "ic" + (extra ? " " + extra : ""));
  s.innerHTML = ICONS[name] || "";
  return s;
}

// ── app state ────────────────────────────────────────────────────────────────

const S = {
  data: null, // last /state payload, normalised
  connError: null, // last poll failure (shown as a banner while data exists)
  route: parseRoute(),
  detail: null, // Review (or its summary as a placeholder while the full one loads)
  detailFor: null,
  detailError: null,
  draft: null, // new-review form draft — survives closing the modal until a start succeeds
  lastFolder: null,
  menu: null, // open row menu {id, menu, btn}
  filters: new Set(SEVERITIES),
  consensusOnly: false,
  open: { log: false, prompt: false, dropped: false, ignored: false, pubPreview: false },
  promptDraft: null, // global prompt editor text (null = reload from settings)
  promptBase: null, // last saved prompt — dirty = draft !== base
  pub: newPub(), // publish form for the open review: decision, body draft, preview
  triageOverlay: {}, // optimistic triage {index: {ignored, comment}} until the save lands
  editing: {}, // open comment editors {index: draft text}
};
let listSig = "";
let detailSig = "";
let pendingListRefresh = false;
let listBody = null;
let listCount = null;
let detailBody = null;

const style = document.createElement("style");
style.textContent = CSS;
document.head.appendChild(style);

const app = document.getElementById("app");
const bannerSlot = h("div");
const viewSlot = h("div");
app.appendChild(h("div", { class: "page", testid: "pr-review-page" }, bannerSlot, viewSlot));

// ── routing ──────────────────────────────────────────────────────────────────

function parseRoute() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash.startsWith("review/")) {
    try {
      return { view: "review", id: decodeURIComponent(hash.slice(7)) };
    } catch (_e) {
      return { view: "review", id: hash.slice(7) };
    }
  }
  if (hash === "prompt") return { view: "prompt" };
  return { view: "list" };
}
const reviewHash = (id) => "#/review/" + encodeURIComponent(id);

function go(hash) {
  if (window.location.hash === hash) {
    S.route = parseRoute();
    onRouteChange();
  } else {
    window.location.hash = hash;
  }
}

let routeGuard = false;
window.addEventListener("hashchange", async () => {
  if (routeGuard) {
    routeGuard = false;
    return;
  }
  const next = parseRoute();
  const leavingPrompt = S.route.view === "prompt" && next.view !== "prompt";
  if (leavingPrompt && S.promptDraft !== null && S.promptDraft !== S.promptBase) {
    const target = window.location.hash;
    routeGuard = true;
    window.location.hash = "#/prompt";
    const ok = await confirmDialog({
      title: "Discard unsaved changes?",
      message: "Your edits to the global prompt haven't been saved.",
      confirmLabel: "Discard",
      cancelLabel: "Keep editing",
      danger: true,
    });
    if (!ok) return;
    S.promptDraft = null;
    S.promptBase = null;
    window.location.hash = target;
    return;
  }
  S.route = next;
  onRouteChange();
});

function onRouteChange() {
  const r = S.route;
  if (r.view !== "review") {
    S.detail = null;
    S.detailFor = null;
    S.detailError = null;
  } else if (S.detailFor !== r.id) {
    // Show the list's summary immediately; the full review replaces it.
    S.detail = (S.data && S.data.reviews.find((x) => x.id === r.id)) || null;
    S.detailFor = r.id;
    S.detailError = null;
    S.open = { log: false, prompt: false, dropped: false, ignored: false, pubPreview: false };
    S.filters = new Set(SEVERITIES);
    S.consensusOnly = false;
    S.pub = newPub();
    S.triageOverlay = {};
    S.editing = {};
  }
  if (r.view === "prompt") {
    S.promptDraft = null;
    S.promptBase = null;
  }
  listSig = "";
  detailSig = "";
  render();
  window.scrollTo(0, 0);
  refresh();
}

// ── polling ──────────────────────────────────────────────────────────────────

let pollTimer = null;
let inflight = null;
let again = false;

async function refresh() {
  clearTimeout(pollTimer);
  if (inflight) {
    again = true;
    return;
  }
  const route = S.route;
  inflight = (async () => {
    try {
      const [st, det] = await Promise.all([
        getJSON(P + "/state"),
        route.view === "review"
          ? getJSON(P + "/review?id=" + encodeURIComponent(route.id)).then(
              (ok) => ({ ok }),
              (err) => ({ err }),
            )
          : Promise.resolve(null),
      ]);
      S.connError = null;
      applyState(st);
      if (det && S.route.view === "review" && S.route.id === route.id) applyDetail(det);
    } catch (e) {
      S.connError = e.message || "request failed";
      if (S.route.view === "list" && !S.data) fillList();
      if (S.route.view === "prompt" && !S.data) render();
    }
    renderBanner();
  })();
  await inflight;
  inflight = null;
  if (again) {
    again = false;
    refresh();
    return;
  }
  schedulePoll();
}

function schedulePoll() {
  clearTimeout(pollTimer);
  // A posting publish counts as active too: its status lands via the poll.
  const active = (S.data && S.data.reviews.some(pollsFast)) || (S.detail && pollsFast(S.detail));
  pollTimer = setTimeout(refresh, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
}

function applyState(st) {
  const first = !S.data;
  S.data = {
    reviews: st.reviews || [],
    folders: st.folders || [],
    models: st.models || [],
    settings: st.settings || {},
  };
  if (S.route.view === "list") {
    // fillList records the signature it drew, so an unchanged poll is a no-op.
    if (first || JSON.stringify(S.data.reviews) !== listSig) {
      // Never rebuild under an open row menu — it would vanish mid-click.
      if (S.menu) pendingListRefresh = true;
      else fillList();
    }
  } else if (S.route.view === "prompt" && first) {
    render();
  }
  if (first && S.pendingNew) openNewReview();
}

function applyDetail(det) {
  if (det.err) {
    if (!S.detail || !("result" in S.detail)) {
      S.detailError = det.err.message || "Couldn't load this review.";
      S.detail = null;
      detailSig = "";
      redrawDetail();
    } else {
      S.connError = det.err.message;
    }
    return;
  }
  const review = det.ok && det.ok.review;
  if (!review) return;
  S.detail = review;
  S.detailError = null;
  maybeLoadPreview(review);
  const sig = JSON.stringify(review);
  if (sig !== detailSig) {
    detailSig = sig;
    redrawDetail();
  }
}

// Relative times and live elapsed counters tick in place, so a poll never
// has to rebuild the DOM just because a minute passed.
setInterval(() => {
  const now = Date.now();
  for (const n of document.querySelectorAll("[data-rel]")) n.textContent = relTime(Number(n.dataset.rel), now);
  for (const n of document.querySelectorAll("[data-live-start]"))
    n.textContent = duration(now - Number(n.dataset.liveStart));
}, 1000);

// ── shared bits ──────────────────────────────────────────────────────────────

function render() {
  pendingListRefresh = false;
  closeMenu();
  clear(viewSlot);
  listBody = null;
  listCount = null;
  detailBody = null;
  if (S.route.view === "review") viewSlot.appendChild(renderDetailView());
  else if (S.route.view === "prompt") viewSlot.appendChild(renderPromptView());
  else viewSlot.appendChild(renderListView());
  renderBanner();
}

function renderBanner() {
  clear(bannerSlot);
  if (S.connError && S.data) {
    bannerSlot.appendChild(
      h(
        "div",
        { class: "banner", role: "status", testid: "pr-review-conn-error" },
        icon("alert"),
        h("span", null, "Can't reach the server — retrying. ", h("span", { class: "muted" }, S.connError)),
      ),
    );
  }
}

function backLink() {
  return h(
    "div",
    { class: "back-link" },
    h("a", { class: "link-btn", href: "#/", testid: "pr-review-back" }, icon("back"), "All reviews"),
  );
}

function skeletons(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(h("div", { class: "skeleton", "aria-hidden": "true" }));
  return out;
}

function relEl(ms) {
  const s = h("span");
  if (ms === null || ms === undefined) return s;
  s.dataset.rel = String(ms);
  s.textContent = relTime(ms, Date.now());
  s.title = new Date(ms).toLocaleString();
  return s;
}

function elapsedEl(r) {
  const s = h("span");
  const start = toMs(r.created_at);
  s.textContent = duration(elapsedMs(r, Date.now()));
  if (toMs(r.finished_at) === null && isActive(r) && start !== null) s.dataset.liveStart = String(start);
  return s;
}

function statusPill(status) {
  return h(
    "span",
    { class: "pill pill-" + status, testid: "pr-review-status", "data-status": status },
    h("i", { class: "dot", "aria-hidden": "true" }),
    STATUS_LABELS[status] || status,
  );
}

// The model's verdict is only a suggestion — muted, labelled as such, so it
// never reads as the decision (the user makes that when publishing).
function verdictBadge(v, large) {
  const ic = v === "approve" ? "check" : v === "request_changes" ? "alert" : "comment";
  return h(
    "span",
    {
      class: "verdict verdict-suggest verdict-" + v + (large ? " verdict-lg" : ""),
      testid: "pr-review-verdict",
      "data-verdict": v,
      title: "The review model's suggestion — you choose the decision when publishing",
    },
    icon(ic),
    h("span", { class: "verdict-prefix" }, "Model suggests:"),
    VERDICT_LABELS[v] || v,
  );
}

// The user's published decision on a list row.
function publishChipEl(publish) {
  const c = publishChip(publish);
  if (!c) return null;
  const ic = c.status === "running" ? "loader" : c.status === "failed" ? "alert" : "check";
  return h(
    "span",
    {
      class: "pub-chip pub-" + c.status + (c.status === "posted" ? " pub-" + publish.decision : ""),
      testid: "pr-review-publish-chip",
      "data-status": c.status,
      "data-decision": publish.decision || null,
      title: c.status === "posted" ? "Your review was posted to GitHub" : null,
    },
    icon(ic),
    c.label,
  );
}

// Verdict lives in the result; summaries may carry it top-level.
const verdictOf = (r) => r.verdict || (r.result && r.result.verdict) || null;

function branchTitle(r) {
  return [
    h("span", { class: "rv-branch", title: r.branch }, r.branch),
    h("span", { class: "rv-arrow", "aria-label": "into" }, "→"),
    r.base
      ? h("span", { class: "rv-base", title: r.base }, r.base)
      : h("span", { class: "rv-base auto", title: "Base branch detected automatically" }, "auto-detect"),
  ];
}

const PROVIDER_ICON = { pending: "circle", running: "loader", done: "check", failed: "x" };
const PROVIDER_STATE = { pending: "waiting", running: "reviewing", done: "finished", failed: "failed" };

function providerChips(providers) {
  return Object.entries(providers || {}).map(([p, st]) =>
    h(
      "span",
      {
        class: "pchip pchip-" + st,
        testid: "pr-review-provider-chip",
        "data-provider": p,
        "data-state": st,
        title: providerLabel(p) + " — " + (PROVIDER_STATE[st] || st),
      },
      icon(PROVIDER_ICON[st] || "circle"),
      providerLabel(p),
    ),
  );
}

function reviewerLabel(id) {
  if (typeof id !== "string") return "";
  return id.includes(":") ? modelName(S.data && S.data.models, id) : providerLabel(id);
}

function countBadges(counts) {
  const c = counts || {};
  const out = [];
  for (const s of SEVERITIES) {
    const n = c[s] || 0;
    if (n > 0)
      out.push(
        h(
          "span",
          { class: "sev sev-" + s, testid: "pr-review-count", "data-severity": s },
          h("b", null, String(n)),
          SEVERITY_LABELS[s].toLowerCase(),
        ),
      );
  }
  if (c.praise > 0)
    out.push(
      h(
        "span",
        { class: "sev sev-praise", testid: "pr-review-count", "data-severity": "praise", title: c.praise + " praise" },
        icon("star"),
        h("b", null, String(c.praise)),
      ),
    );
  return out;
}

function miniSteps(r) {
  const states = stepStates(r);
  return h(
    "div",
    { class: "mini-steps", role: "img", "aria-label": progressCaption(r) },
    STEPS.map((s, i) => h("i", { class: states[i], title: STEP_LABELS[s] })),
  );
}

// ── actions ──────────────────────────────────────────────────────────────────

async function doRerun(r) {
  try {
    const res = await postJSON(P + "/rerun", { id: r.id });
    toast("Re-run started");
    const id = res && res.review && res.review.id;
    if (S.route.view === "review" && id && id !== S.route.id) go(reviewHash(id));
    else refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function doCancel(r) {
  const ok = await confirmDialog({
    title: "Cancel this review?",
    message: "Reviewers still working on " + r.branch + " are stopped. You can re-run it later.",
    confirmLabel: "Cancel review",
    cancelLabel: "Keep running",
    danger: true,
  });
  if (!ok) return;
  try {
    await postJSON(P + "/cancel", { id: r.id });
    toast("Review cancelled");
    refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function doDelete(r) {
  const ok = await confirmDialog({
    title: "Delete this review?",
    message: "The review of " + r.branch + " and its findings are removed from this list. This can't be undone.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await postJSON(P + "/delete", { id: r.id });
    toast("Review deleted");
    if (S.route.view === "review" && S.route.id === r.id) go("#/");
    else refresh();
  } catch (e) {
    toast(e.message, "error");
  }
}

function reviewActions(r) {
  const active = isActive(r);
  return [
    {
      label: "Open session",
      icon: "session",
      action: "open-session",
      disabled: !r.session_id,
      run: () => openSession(r.session_id),
    },
    { label: "Re-run", icon: "rerun", action: "rerun", disabled: active, run: () => doRerun(r) },
    active ? { label: "Cancel", icon: "stop", action: "cancel", run: () => doCancel(r) } : null,
    { divider: true },
    { label: "Delete", icon: "trash", action: "delete", danger: true, run: () => doDelete(r) },
  ].filter(Boolean);
}

// ── row menu ─────────────────────────────────────────────────────────────────

function rowMenu(r) {
  const wrap = h("div", { class: "rv-menu" });
  const btn = h(
    "button",
    {
      class: "icon-btn",
      type: "button",
      "aria-label": "Review actions",
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      testid: "pr-review-row-menu",
      onclick: () => toggleMenu(r, wrap, btn),
    },
    icon("more"),
  );
  wrap.appendChild(btn);
  // Clicks inside the menu never reach the row (which would open the detail)
  // nor the document (which closes the menu).
  wrap.addEventListener("click", (e) => e.stopPropagation());
  return wrap;
}

function toggleMenu(r, wrap, btn) {
  if (S.menu && S.menu.id === r.id) {
    closeMenu();
    return;
  }
  closeMenu(true);
  const menu = h("div", { class: "menu", role: "menu", testid: "pr-review-menu" });
  for (const it of reviewActions(r)) {
    if (it.divider) {
      menu.appendChild(h("div", { class: "menu-divider", role: "separator" }));
      continue;
    }
    menu.appendChild(
      h(
        "button",
        {
          class: "menu-item" + (it.danger ? " danger" : ""),
          type: "button",
          role: "menuitem",
          disabled: !!it.disabled,
          testid: "pr-review-menu-" + it.action,
          onclick: () => {
            closeMenu();
            it.run();
          },
        },
        icon(it.icon),
        it.label,
      ),
    );
  }
  wrap.appendChild(menu);
  btn.setAttribute("aria-expanded", "true");
  const rect = menu.getBoundingClientRect();
  if (rect.bottom > window.innerHeight - 8 && btn.getBoundingClientRect().top > rect.height + 16) {
    menu.classList.add("up");
  }
  S.menu = { id: r.id, menu, btn };
  const first = menu.querySelector(".menu-item:not(:disabled)");
  if (first) first.focus();
}

// `keepPending` holds a deferred list rebuild back — used when another row's
// menu is about to open on the current DOM.
function closeMenu(keepPending) {
  if (!S.menu) return;
  S.menu.menu.remove();
  S.menu.btn.setAttribute("aria-expanded", "false");
  S.menu = null;
  if (pendingListRefresh && !keepPending) {
    pendingListRefresh = false;
    fillList();
  }
}

document.addEventListener("click", () => closeMenu());

// ── modal / confirm / toast ──────────────────────────────────────────────────

const modalStack = [];

function openModal({ title, body, foot, size, testid, initialFocus, onClose }) {
  const prevFocus = document.activeElement;
  const dialog = h("div", {
    class: "modal" + (size ? " " + size : ""),
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
    testid,
  });
  let closed = false;
  const entry = { dialog, close };
  const backdrop = h(
    "div",
    {
      class: "modal-backdrop",
      onmousedown: (e) => {
        if (e.target === backdrop) close();
      },
    },
    dialog,
  );
  append(dialog, [
    h(
      "div",
      { class: "modal-head" },
      h("h2", null, title),
      h("button", { class: "icon-btn", type: "button", "aria-label": "Close", onclick: () => close() }, icon("x")),
    ),
    h("div", { class: "modal-body" }, body),
    foot ? h("div", { class: "modal-foot" }, foot) : null,
  ]);
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    modalStack.splice(modalStack.indexOf(entry), 1);
    if (onClose) onClose();
    if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus();
  }
  document.body.appendChild(backdrop);
  modalStack.push(entry);
  setTimeout(() => {
    const f = initialFocus || dialog.querySelector("input:not(:disabled), textarea, select, .btn-primary");
    if (f) f.focus();
  }, 0);
  return entry;
}

function confirmDialog({ title, message, confirmLabel, cancelLabel, danger }) {
  return new Promise((resolve) => {
    let result = false;
    const okBtn = h(
      "button",
      {
        class: "btn " + (danger ? "btn-danger" : "btn-primary"),
        type: "button",
        testid: "pr-review-confirm-ok",
        onclick: () => {
          result = true;
          m.close();
        },
      },
      confirmLabel || "Confirm",
    );
    const cancelBtn = h(
      "button",
      { class: "btn", type: "button", testid: "pr-review-confirm-cancel", onclick: () => m.close() },
      cancelLabel || "Cancel",
    );
    const m = openModal({
      title,
      size: "sm",
      testid: "pr-review-confirm",
      body: h("p", null, message),
      foot: [h("span", { class: "spacer" }), cancelBtn, okBtn],
      initialFocus: danger ? cancelBtn : okBtn,
      onClose: () => resolve(result),
    });
  });
}

function trapFocus(e, root) {
  const focusable = Array.from(
    root.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((n) => n.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

document.addEventListener("keydown", (e) => {
  const top = modalStack[modalStack.length - 1];
  if (top) {
    if (e.key === "Escape") {
      e.preventDefault();
      top.close();
    } else if (e.key === "Tab") {
      trapFocus(e, top.dialog);
    }
    return;
  }
  if (!S.menu) return;
  if (e.key === "Escape") {
    const b = S.menu.btn;
    closeMenu();
    b.focus();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const items = Array.from(S.menu.menu.querySelectorAll(".menu-item:not(:disabled)"));
    const i = items.indexOf(document.activeElement);
    const n = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    if (items[n]) items[n].focus();
  } else if (e.key === "Tab") {
    closeMenu();
  }
});

let toastEl = null;
let toastTimer = null;
function toast(msg, kind) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastTimer);
  toastEl = h(
    "div",
    { class: "toast" + (kind === "error" ? " error" : ""), role: "status", testid: "pr-review-toast" },
    icon(kind === "error" ? "alert" : "check"),
    msg,
  );
  document.body.appendChild(toastEl);
  toastTimer = setTimeout(
    () => {
      if (toastEl) toastEl.remove();
      toastEl = null;
    },
    kind === "error" ? 6000 : 3200,
  );
}

// ── list view ────────────────────────────────────────────────────────────────

function renderListView() {
  listCount = h("span", { class: "count-chip", testid: "pr-review-count-chip" });
  listCount.hidden = true;
  const view = h(
    "div",
    { class: "view view-list" },
    h(
      "div",
      { class: "view-head" },
      h(
        "div",
        { class: "view-head-text" },
        h("h1", null, "PR Reviews", listCount),
        h(
          "p",
          null,
          "Several models review a branch in parallel; their findings are merged, verified, and ranked into one list of recommended changes.",
        ),
      ),
      h(
        "div",
        { class: "view-head-actions" },
        h(
          "button",
          { class: "btn", type: "button", testid: "pr-review-prompt-btn", onclick: () => go("#/prompt") },
          icon("prompt"),
          "Global prompt",
        ),
        h(
          "button",
          { class: "btn btn-primary", type: "button", testid: "pr-review-new-btn", onclick: openNewReview },
          icon("plus"),
          "New review",
        ),
      ),
    ),
  );
  listBody = h("div", { class: "rv-table", testid: "pr-review-list" });
  view.appendChild(listBody);
  fillList();
  return view;
}

function fillList() {
  if (!listBody) return;
  clear(listBody);
  if (!S.data) {
    if (S.connError) {
      listBody.appendChild(
        h(
          "div",
          { class: "empty", testid: "pr-review-load-error" },
          h("div", { class: "empty-icon" }, icon("alert")),
          h("h2", null, "Couldn't load reviews"),
          h("p", null, S.connError),
          h("button", { class: "btn", type: "button", onclick: () => refresh() }, icon("rerun"), "Try again"),
        ),
      );
    } else {
      append(listBody, skeletons(3));
    }
    return;
  }
  const reviews = S.data.reviews;
  listSig = JSON.stringify(reviews);
  const active = reviews.filter(isActive).length;
  if (listCount) {
    listCount.hidden = !reviews.length;
    listCount.textContent = active ? active + " running · " + reviews.length + " total" : String(reviews.length);
  }
  if (!reviews.length) {
    listBody.appendChild(emptyState());
    return;
  }
  listBody.appendChild(
    h(
      "div",
      { class: "rv-cols", "aria-hidden": "true" },
      h("span", null, "Branch"),
      h("span", null, "Progress"),
      h("span", null, "Reviewers"),
      h("span", null, "Findings"),
      h("span"),
    ),
  );
  for (const r of reviews) listBody.appendChild(reviewRow(r));
}

function emptyState() {
  return h(
    "div",
    { class: "empty", testid: "pr-review-empty" },
    h("div", { class: "empty-icon" }, icon("pr")),
    h("h2", null, "No reviews yet"),
    h(
      "p",
      null,
      "Point a review at a branch in one of your folders. Several models review the change side by side, " +
        "then their findings are merged, double-checked, and ranked — blockers first — with a clear verdict.",
    ),
    h(
      "div",
      { class: "empty-steps", "aria-hidden": "true" },
      STEPS.slice(1, -1).map((s) => h("span", null, STEP_LABELS[s])),
    ),
    h(
      "button",
      { class: "btn btn-primary", type: "button", testid: "pr-review-empty-new", onclick: openNewReview },
      icon("plus"),
      "Start your first review",
    ),
  );
}

function reviewRow(r) {
  const open = () => go(reviewHash(r.id));
  const models = S.data ? S.data.models : [];
  const created = toMs(r.created_at);
  const el = elapsedMs(r, Date.now());
  const verdict = verdictOf(r);
  const counts = countBadges(r.counts);
  const row = h(
    "div",
    {
      class: "rv-row" + (r.status === "running" ? " is-running" : "") + (r.status === "failed" ? " is-failed" : ""),
      role: "link",
      tabindex: "0",
      testid: "pr-review-row",
      "data-id": r.id,
      "data-status": r.status,
      "aria-label": "Review of " + r.branch + ", " + (STATUS_LABELS[r.status] || r.status),
      onclick: () => {
        const sel = window.getSelection && window.getSelection();
        if (sel && String(sel).length) return; // the user was selecting text
        open();
      },
      onkeydown: (e) => {
        if ((e.key === "Enter" || e.key === " ") && e.target === row) {
          e.preventDefault();
          open();
        }
      },
    },
    h(
      "div",
      { class: "rv-cell" },
      h("div", { class: "rv-title" }, branchTitle(r)),
      h(
        "div",
        { class: "rv-meta" },
        h("span", { class: "rv-folder", title: r.folder_path || "" }, icon("folder"), r.folder_name || "—"),
        r.model ? h("span", { title: r.model }, icon("cpu"), modelName(models, r.model)) : null,
        created !== null ? h("span", null, icon("clock"), relEl(created)) : null,
        el !== null ? h("span", { title: isActive(r) ? "Running for" : "Took" }, icon("timer"), elapsedEl(r)) : null,
      ),
    ),
    h(
      "div",
      { class: "rv-cell rv-progress" },
      h("div", { class: "rv-progress-top" }, statusPill(r.status), miniSteps(r)),
      h("div", { class: "rv-caption" }, progressCaption(r)),
    ),
    h(
      "div",
      { class: "rv-cell rv-chips" },
      Object.keys(r.providers || {}).length
        ? providerChips(r.providers)
        : h("span", { class: "muted" }, isActive(r) ? "Not started yet" : "—"),
    ),
    h(
      "div",
      { class: "rv-cell rv-outcome" },
      publishChipEl(r.publish),
      verdict ? verdictBadge(verdict) : null,
      counts,
      r.status === "done" && !counts.length && !verdict ? h("span", { class: "muted" }, "No findings") : null,
      !counts.length && r.status !== "done" ? h("span", { class: "muted" }, isActive(r) ? "In progress" : "—") : null,
    ),
    rowMenu(r),
  );
  return row;
}

// ── new review form ──────────────────────────────────────────────────────────

function openNewReview() {
  // Clicked before the first state load: open as soon as it lands.
  if (!S.data) {
    S.pendingNew = true;
    return;
  }
  S.pendingNew = false;
  const folders = S.data.folders;
  const models = S.data.models;
  const settings = S.data.settings;
  if (!S.draft) {
    const preset =
      folders.length === 1
        ? folders[0].id
        : S.lastFolder && folders.some((f) => f.id === S.lastFolder)
          ? S.lastFolder
          : null;
    S.draft = { branch: "", base: "", folder_id: preset, model: settings.default_model || "", prompt: "" };
  }
  const d = S.draft;
  const touched = {};
  const serverErr = {};
  let tried = false;
  let submitting = false;
  let formErr = "";
  const fields = {};

  function field(name, label, control, opts) {
    const errEl = h("div", {
      class: "field-error",
      testid: "pr-review-field-error",
      "data-field": name,
      role: "alert",
    });
    errEl.hidden = true;
    const wrap = h(
      "div",
      { class: "field" + (opts.full ? " full" : "") },
      h(
        "label",
        { class: "field-label", for: opts.id },
        label,
        opts.required
          ? h("span", { class: "req", "aria-hidden": "true" }, "*")
          : h("span", { class: "opt" }, "optional"),
      ),
      control,
      opts.hint ? h("div", { class: "field-hint" }, opts.hint) : null,
      errEl,
    );
    fields[name] = { wrap, errEl };
    return wrap;
  }

  const enterSubmits = (e) => {
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const branchIn = h("input", {
    class: "input mono",
    id: "prr-branch",
    type: "text",
    value: d.branch,
    placeholder: "feature/my-change",
    autocomplete: "off",
    spellcheck: "false",
    "aria-required": "true",
    testid: "pr-review-branch",
    oninput: () => {
      d.branch = branchIn.value;
      delete serverErr.branch;
      update();
    },
    onblur: () => {
      touched.branch = true;
      update();
    },
    onkeydown: enterSubmits,
  });
  const baseIn = h("input", {
    class: "input mono",
    id: "prr-base",
    type: "text",
    value: d.base,
    placeholder: "auto-detect",
    autocomplete: "off",
    spellcheck: "false",
    testid: "pr-review-base",
    oninput: () => {
      d.base = baseIn.value;
      delete serverErr.base;
      update();
    },
    onblur: () => {
      touched.base = true;
      update();
    },
    onkeydown: enterSubmits,
  });

  const combo = folderCombobox(
    folders,
    d.folder_id,
    (id) => {
      d.folder_id = id;
      delete serverErr.folder_id;
      if (id) touched.folder_id = true;
      update();
    },
    () => {
      touched.folder_id = true;
      update();
    },
  );

  const modelSel = h("select", {
    class: "select",
    id: "prr-model",
    testid: "pr-review-model",
    disabled: !models.length && !d.model,
    onchange: () => {
      d.model = modelSel.value;
      delete serverErr.model;
      update();
    },
  });
  if (d.model && !models.some((m) => m.id === d.model)) {
    modelSel.appendChild(h("option", { value: d.model }, modelName(models, d.model) + " (default)"));
  }
  if (!models.length && !d.model) modelSel.appendChild(h("option", { value: "" }, "Server default"));
  for (const [p, list] of groupModels(models)) {
    modelSel.appendChild(
      h(
        "optgroup",
        { label: providerLabel(p) },
        list.map((m) =>
          h(
            "option",
            { value: m.id },
            (m.display_name || m.id) + (m.id === settings.default_model ? " (default)" : ""),
          ),
        ),
      ),
    );
  }
  modelSel.value = d.model || (models[0] ? models[0].id : "");
  d.model = modelSel.value;

  const promptIn = h("textarea", {
    class: "textarea",
    id: "prr-prompt",
    rows: "4",
    value: d.prompt,
    placeholder: "e.g. Pay extra attention to the migration's rollback path and error handling in the new API routes.",
    testid: "pr-review-custom-prompt",
    oninput: () => {
      d.prompt = promptIn.value;
    },
    onkeydown: (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    },
  });

  const formErrEl = h("div", { class: "form-error", role: "alert", testid: "pr-review-form-error" });
  formErrEl.hidden = true;

  const body = h(
    "div",
    { testid: "pr-review-form" },
    h(
      "div",
      { class: "form-grid" },
      field("branch", "Branch", branchIn, { id: "prr-branch", required: true }),
      field("base", "Base branch", baseIn, {
        id: "prr-base",
        hint: "Leave blank to detect it automatically.",
      }),
      field("folder_id", "Target folder", combo.el, {
        id: "prr-folder",
        required: true,
        full: true,
        hint: folders.length ? "The folder whose repository holds the branch." : "Add a folder in Peckboard first.",
      }),
      field("model", "Model", modelSel, {
        id: "prr-model",
        full: true,
        hint: "Runs the review session.",
      }),
      field("prompt", "Custom prompt", promptIn, {
        id: "prr-prompt",
        full: true,
        hint: h(
          "span",
          null,
          "Appended to the ",
          h(
            "a",
            {
              href: "#/prompt",
              onclick: () => modal.close(),
            },
            "global prompt",
          ),
          " for this review only.",
        ),
      }),
    ),
    formErrEl,
  );

  const reasonEl = h("span", { class: "form-actions-reason", testid: "pr-review-start-reason" });
  const startBtn = h(
    "button",
    { class: "btn btn-primary", type: "button", testid: "pr-review-start", onclick: () => submit() },
    "Start review",
  );
  const cancelBtn = h("button", { class: "btn", type: "button", onclick: () => modal.close() }, "Cancel");

  const modal = openModal({
    title: "New review",
    body,
    foot: [reasonEl, h("span", { class: "spacer" }), cancelBtn, startBtn],
    testid: "pr-review-new-modal",
    initialFocus: branchIn,
  });

  function update() {
    const errs = validateStart(d, folders);
    const all = Object.assign({}, errs, serverErr);
    for (const name of Object.keys(fields)) {
      const f = fields[name];
      const msg = all[name] && (touched[name] || tried || serverErr[name]) ? all[name] : "";
      f.wrap.classList.toggle("has-error", !!msg);
      f.errEl.hidden = !msg;
      clear(f.errEl);
      if (msg) append(f.errEl, [icon("alert"), msg]);
    }
    const blocked = startBlockReason(errs);
    startBtn.disabled = submitting || !!blocked;
    startBtn.textContent = submitting ? "Starting…" : "Start review";
    reasonEl.textContent = submitting ? "" : !folders.length ? "Add a folder in Peckboard first." : blocked || "";
    formErrEl.hidden = !formErr;
    formErrEl.textContent = formErr;
  }

  async function submit() {
    tried = true;
    const errs = validateStart(d, folders);
    update();
    if (submitting) return;
    if (Object.keys(errs).length) {
      const first = errs.branch ? branchIn : errs.base ? baseIn : combo.input;
      first.focus();
      return;
    }
    submitting = true;
    formErr = "";
    update();
    try {
      const req = { branch: d.branch.trim(), folder_id: d.folder_id };
      if (d.base.trim()) req.base = d.base.trim();
      if (d.model) req.model = d.model;
      if (d.prompt.trim()) req.prompt = d.prompt.trim();
      const res = await postJSON(P + "/start", req);
      S.lastFolder = d.folder_id;
      S.draft = null;
      modal.close();
      toast("Review started");
      const review = res && res.review;
      if (review && review.id) {
        S.detail = review;
        S.detailFor = review.id;
        S.detailError = null;
        go(reviewHash(review.id));
      } else {
        refresh();
      }
    } catch (e) {
      submitting = false;
      const f = fieldForError(e.message);
      if (f && fields[f]) serverErr[f] = e.message;
      else formErr = e.message;
      update();
    }
  }

  update();
}

/** Searchable folder picker (ARIA combobox). Folders can be many, so it
 * filters by name and path as you type; arrow keys + Enter pick. */
function folderCombobox(folders, selectedId, onChange, onBlur) {
  let cur = selectedId;
  let open = false;
  let activeIdx = -1;
  let matches = [];
  const selected = () => folders.find((f) => f.id === cur) || null;

  const input = h("input", {
    class: "input",
    id: "prr-folder",
    type: "text",
    role: "combobox",
    autocomplete: "off",
    spellcheck: "false",
    "aria-autocomplete": "list",
    "aria-expanded": "false",
    "aria-controls": "prr-folder-list",
    "aria-required": "true",
    placeholder: folders.length ? "Search folders…" : "No folders yet",
    disabled: !folders.length,
    testid: "pr-review-folder",
  });
  const list = h("ul", {
    class: "combo-list",
    id: "prr-folder-list",
    role: "listbox",
    testid: "pr-review-folder-list",
  });
  list.hidden = true;
  const toggle = h(
    "button",
    {
      class: "combo-toggle",
      type: "button",
      tabindex: "-1",
      "aria-label": "Show folders",
      disabled: !folders.length,
      onmousedown: (e) => {
        e.preventDefault();
        if (open) close();
        else {
          input.focus();
          openList("");
        }
      },
    },
    icon("chevDown"),
  );
  const pathEl = h("div", { class: "combo-selected-path", testid: "pr-review-folder-path" });

  function syncInput() {
    const s = selected();
    input.value = s ? s.name : "";
    pathEl.textContent = s ? s.path : "";
    pathEl.hidden = !s;
  }
  function highlight() {
    Array.from(list.children).forEach((li, i) => li.classList.toggle("active", i === activeIdx));
    if (activeIdx >= 0 && list.children[activeIdx] && matches.length) {
      input.setAttribute("aria-activedescendant", "prr-folder-opt-" + activeIdx);
      list.children[activeIdx].scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }
  function renderList() {
    clear(list);
    if (!matches.length) {
      list.appendChild(h("li", { class: "combo-empty" }, "No folders match “" + input.value.trim() + "”"));
      return;
    }
    matches.forEach((f, i) => {
      list.appendChild(
        h(
          "li",
          {
            class: "combo-option",
            id: "prr-folder-opt-" + i,
            role: "option",
            "aria-selected": String(f.id === cur),
            testid: "pr-review-folder-option",
            "data-id": f.id,
            onmousedown: (e) => {
              e.preventDefault();
              choose(f);
            },
            onmousemove: () => {
              if (activeIdx !== i) {
                activeIdx = i;
                highlight();
              }
            },
          },
          h("span", { class: "co-name" }, icon("folder"), f.name),
          f.path ? h("span", { class: "co-path" }, f.path) : null,
        ),
      );
    });
  }
  function openList(q) {
    matches = filterFolders(folders, q);
    activeIdx = matches.findIndex((f) => f.id === cur);
    if (activeIdx < 0 && matches.length) activeIdx = 0;
    open = true;
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    renderList();
    highlight();
  }
  function close() {
    open = false;
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function choose(f) {
    cur = f.id;
    syncInput();
    close();
    onChange(f.id);
  }

  input.addEventListener("focus", () => {
    input.select();
    openList("");
  });
  input.addEventListener("input", () => {
    if (cur) {
      cur = null;
      pathEl.hidden = true;
      onChange(null);
    }
    openList(input.value);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList(input.value);
      else if (matches.length) {
        activeIdx = (activeIdx + 1) % matches.length;
        highlight();
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open && matches.length) {
        activeIdx = (activeIdx - 1 + matches.length) % matches.length;
        highlight();
      }
    } else if (e.key === "Enter") {
      if (open && matches[activeIdx]) {
        e.preventDefault();
        choose(matches[activeIdx]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        // Close the list only — not the whole modal.
        e.preventDefault();
        e.stopPropagation();
        close();
        syncInput();
      }
    } else if (e.key === "Tab") {
      if (open && !cur && input.value.trim() && matches[activeIdx]) choose(matches[activeIdx]);
      else close();
    }
  });
  input.addEventListener("blur", () => {
    close();
    syncInput();
    if (onBlur) onBlur();
  });
  syncInput();

  return { el: h("div", null, h("div", { class: "combo" }, input, toggle, list), pathEl), input };
}

// ── global prompt editor ─────────────────────────────────────────────────────

function renderPromptView() {
  const view = h("div", { class: "view view-prompt", testid: "pr-review-prompt-view" }, backLink());
  if (!S.data) {
    if (S.connError) view.appendChild(h("div", { class: "form-error" }, S.connError));
    else append(view, skeletons(2));
    return view;
  }
  const st = S.data.settings;
  const def = st.default_global_prompt || "";
  if (S.promptDraft === null) {
    S.promptBase = st.global_prompt || def;
    S.promptDraft = S.promptBase;
  }
  let saving = false;

  const badge = h("span", { class: "prompt-badge", testid: "pr-review-prompt-badge" });
  const ta = h("textarea", {
    class: "prompt-editor",
    spellcheck: "false",
    "aria-label": "Global review prompt",
    value: S.promptDraft,
    testid: "pr-review-prompt-editor",
    oninput: () => {
      S.promptDraft = ta.value;
      sync();
    },
    onkeydown: (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    },
  });
  const status = h("span", { testid: "pr-review-prompt-dirty", "aria-live": "polite" });
  const count = h("span", { class: "char-count" });
  const err = h("div", { class: "form-error", role: "alert", testid: "pr-review-prompt-error" });
  err.hidden = true;
  const resetBtn = h(
    "button",
    { class: "btn", type: "button", testid: "pr-review-prompt-reset", onclick: () => reset() },
    icon("rerun"),
    "Reset to default",
  );
  const saveBtn = h(
    "button",
    { class: "btn btn-primary", type: "button", testid: "pr-review-prompt-save", onclick: () => save() },
    icon("check"),
    "Save",
  );

  function sync() {
    const dirty = S.promptDraft !== S.promptBase;
    clear(status);
    status.className = dirty ? "dirty" : "saved";
    status.dataset.dirty = String(dirty);
    if (dirty) append(status, [h("i", { class: "dot", "aria-hidden": "true" }), "Unsaved changes"]);
    else append(status, [icon("check"), "Saved"]);
    const isDefault = S.promptBase === def;
    badge.textContent = isDefault ? "Default" : "Customized";
    badge.classList.toggle("custom", !isDefault);
    saveBtn.disabled = saving || !dirty;
    saveBtn.lastChild.textContent = saving ? "Saving…" : "Save";
    resetBtn.disabled = saving || (S.promptBase === def && S.promptDraft === def);
    count.textContent = S.promptDraft.length.toLocaleString() + " characters";
  }

  async function persist(text, msg) {
    saving = true;
    err.hidden = true;
    sync();
    try {
      const res = await postJSON(P + "/settings", { global_prompt: text });
      const ns = (res && res.settings) || {};
      S.data.settings = Object.assign({}, S.data.settings, ns);
      const eff = ns.global_prompt || ns.default_global_prompt || def;
      S.promptBase = eff;
      S.promptDraft = eff;
      ta.value = eff;
      toast(msg);
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
    saving = false;
    sync();
  }
  function save() {
    if (saving || S.promptDraft === S.promptBase) return;
    // An empty prompt means "use the default" on the server.
    persist(S.promptDraft.trim() ? S.promptDraft : "", "Global prompt saved");
  }
  async function reset() {
    const ok = await confirmDialog({
      title: "Reset to the default prompt?",
      message: "The customized global prompt is replaced by the built-in default for all future reviews.",
      confirmLabel: "Reset",
      danger: true,
    });
    if (ok) persist("", "Global prompt reset to default");
  }

  append(view, [
    h(
      "div",
      { class: "view-head" },
      h(
        "div",
        { class: "view-head-text" },
        h("h1", null, "Global prompt", badge),
        h(
          "p",
          null,
          "Instructions every reviewer receives for every review. A review's own custom prompt is appended after it.",
        ),
      ),
    ),
    ta,
    err,
    h(
      "div",
      { class: "prompt-bar" },
      status,
      count,
      h("span", { class: "spacer" }),
      h("span", { class: "char-count" }, "Ctrl/⌘ + S to save · an empty prompt restores the default"),
      resetBtn,
      saveBtn,
    ),
  ]);
  sync();
  return view;
}

// ── detail view ──────────────────────────────────────────────────────────────

function renderDetailView() {
  detailBody = buildDetail();
  return h("div", { class: "view view-detail", testid: "pr-review-detail" }, backLink(), detailBody);
}

// `focusKey` names a `data-fk` control to focus afterwards; otherwise the
// focused control (a textarea mid-edit, a radio) is found again in the
// fresh tree by its `data-fk`, so a poll never steals the caret.
function redrawDetail(focusKey) {
  if (!detailBody || !detailBody.isConnected) return;
  const a = document.activeElement;
  const key = focusKey || (a && detailBody.contains(a) && a.dataset ? a.dataset.fk : null);
  const sel =
    !focusKey && key && typeof a.selectionStart === "number" ? [a.selectionStart, a.selectionEnd, a.scrollTop] : null;
  // Swap in one go so the page height (and the scroll position) holds.
  const fresh = buildDetail();
  detailBody.replaceWith(fresh);
  detailBody = fresh;
  if (!key) return;
  const n = fresh.querySelector('[data-fk="' + key + '"]');
  if (!n || n.disabled) return;
  n.focus({ preventScroll: true });
  try {
    if (sel) {
      n.setSelectionRange(sel[0], sel[1]);
      n.scrollTop = sel[2];
    } else if (focusKey && typeof n.value === "string" && n.setSelectionRange) {
      n.setSelectionRange(n.value.length, n.value.length);
    }
  } catch (_e) {
    // radios have no selection
  }
}

function buildDetail() {
  const r = S.detail;
  const box = h("div", { class: "detail-body" });
  if (!r) {
    if (S.detailError) {
      box.appendChild(
        h(
          "div",
          { class: "empty", testid: "pr-review-not-found" },
          h("div", { class: "empty-icon" }, icon("alert")),
          h("h2", null, "Review not available"),
          h("p", null, S.detailError),
          h("a", { class: "btn", href: "#/" }, icon("back"), "Back to all reviews"),
        ),
      );
    } else {
      append(box, skeletons(2));
    }
    return box;
  }
  box.appendChild(detailHeader(r));
  if (r.status === "failed") box.appendChild(errorCard(r));
  if (r.status === "cancelled") {
    box.appendChild(
      h(
        "div",
        { class: "notice-card", testid: "pr-review-cancelled" },
        icon("stop"),
        "This review was cancelled. Re-run it to start over.",
      ),
    );
  }
  // Once there is a result it is what the user came for: findings first,
  // the run's progress + custom prompt below as reference.
  const progress = progressCard(r);
  const promptFold = r.custom_prompt
    ? fold("prompt", ["Custom prompt"], h("pre", { class: "prompt-view" }, r.custom_prompt), {
        standalone: true,
        testid: "pr-review-custom-prompt-view",
      })
    : null;
  const full = "result" in r;
  if (r.result) {
    append(box, resultSections(r));
    append(box, [progress, promptFold].filter(Boolean));
    return box;
  }
  box.appendChild(progress);
  if (promptFold) box.appendChild(promptFold);
  if (!full) {
  } else if (isActive(r)) {
    box.appendChild(
      h(
        "div",
        { class: "card waiting-card", testid: "pr-review-waiting" },
        h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")),
        h(
          "div",
          null,
          h("div", { class: "waiting-title" }, "Review in progress"),
          h("div", { class: "muted" }, "Findings appear here once the reviewers finish and their results are merged."),
        ),
      ),
    );
  } else if (r.status === "done") {
    box.appendChild(h("div", { class: "none-note" }, "This review finished without a result."));
  }
  return box;
}

function detailHeader(r) {
  const models = S.data ? S.data.models : [];
  const verdict = verdictOf(r);
  const created = toMs(r.created_at);
  const el = elapsedMs(r, Date.now());
  const active = isActive(r);
  return h(
    "div",
    { class: "card", testid: "pr-review-detail-header" },
    h(
      "div",
      { class: "detail-head" },
      h(
        "div",
        { class: "detail-head-main" },
        h("div", { class: "detail-badges" }, statusPill(r.status), verdict ? verdictBadge(verdict, true) : null),
        h("h1", { class: "detail-title" }, branchTitle(r)),
        h(
          "div",
          { class: "detail-meta" },
          h("span", { title: r.folder_path || "" }, icon("folder"), h("b", null, r.folder_name || "—")),
          r.folder_path ? h("span", { class: "mono", title: "Folder path" }, r.folder_path) : null,
          r.model ? h("span", { title: r.model }, icon("cpu"), modelName(models, r.model)) : null,
          created !== null ? h("span", null, icon("clock"), "Started ", relEl(created)) : null,
          el !== null ? h("span", null, icon("timer"), active ? "Running for " : "Took ", elapsedEl(r)) : null,
        ),
      ),
      h(
        "div",
        { class: "detail-actions" },
        r.session_id
          ? h(
              "button",
              {
                class: "btn",
                type: "button",
                testid: "pr-review-open-session",
                title: "Open the agent session in a Peckboard tab",
                onclick: () => openSession(r.session_id),
              },
              icon("session"),
              "Open session",
            )
          : null,
        active
          ? h(
              "button",
              { class: "btn btn-ghost-danger", type: "button", testid: "pr-review-cancel", onclick: () => doCancel(r) },
              icon("stop"),
              "Cancel",
            )
          : h(
              "button",
              { class: "btn", type: "button", testid: "pr-review-rerun", onclick: () => doRerun(r) },
              icon("rerun"),
              "Re-run",
            ),
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            "aria-label": "Delete review",
            title: "Delete review",
            testid: "pr-review-delete",
            onclick: () => doDelete(r),
          },
          icon("trash"),
        ),
      ),
    ),
  );
}

function errorCard(r) {
  const step = STEP_LABELS[r.step];
  return h(
    "div",
    { class: "error-card", role: "alert", testid: "pr-review-error" },
    h("span", { class: "err-icon" }, icon("alert")),
    h(
      "div",
      { class: "err-main" },
      h("h3", null, step && r.step !== "done" ? "Review failed while " + step.toLowerCase() : "Review failed"),
      h("pre", null, r.error || "The review stopped without reporting an error."),
      h(
        "div",
        { class: "detail-actions" },
        h(
          "button",
          { class: "btn btn-primary", type: "button", testid: "pr-review-error-rerun", onclick: () => doRerun(r) },
          icon("rerun"),
          "Re-run review",
        ),
        r.session_id
          ? h(
              "button",
              { class: "btn", type: "button", onclick: () => openSession(r.session_id) },
              icon("session"),
              "Inspect session",
            )
          : null,
      ),
    ),
  );
}

function stepper(r) {
  const states = stepStates(r);
  return h(
    "ol",
    { class: "stepper", testid: "pr-review-stepper", "aria-label": "Review progress" },
    STEPS.map((s, i) =>
      h(
        "li",
        {
          class: "step " + states[i],
          "data-step": s,
          "data-state": states[i],
          "aria-current": states[i] === "active" ? "step" : null,
        },
        h(
          "span",
          { class: "step-dot" },
          states[i] === "done" ? icon("check") : states[i] === "failed" ? icon("x") : String(i + 1),
        ),
        h("span", { class: "step-label" }, STEP_LABELS[s]),
      ),
    ),
  );
}

function fold(key, summary, body, opts) {
  const d = h("details", { class: "fold" + (opts.standalone ? " standalone" : ""), testid: opts.testid });
  if (S.open[key]) d.open = true;
  d.addEventListener("toggle", () => {
    S.open[key] = d.open;
  });
  append(d, [h("summary", null, icon("chevRight", "chev"), summary), h("div", { class: "fold-body" }, body)]);
  return d;
}

function logTime(ms) {
  if (ms === null) return "";
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function progressCard(r) {
  const provs = Object.keys(r.providers || {});
  const log = (r.log || []).slice().reverse(); // newest first
  return h(
    "div",
    { class: "card", testid: "pr-review-progress" },
    h("div", { class: "card-title" }, "Progress", h("span", { class: "count-chip" }, progressCaption(r))),
    stepper(r),
    h("div", { class: "section-sub" }, "Reviewers"),
    provs.length
      ? h("div", { class: "rv-chips", testid: "pr-review-providers" }, providerChips(r.providers))
      : h(
          "div",
          { class: "muted", testid: "pr-review-providers" },
          isActive(r) ? "Reviewers start once the branch context is gathered." : "No reviewers ran.",
        ),
    log.length
      ? fold(
          "log",
          ["Activity log ", h("span", { class: "count-chip" }, String(log.length))],
          h(
            "ul",
            { class: "log" },
            log.map((e) => {
              const ms = toMs(e.at);
              return h(
                "li",
                null,
                h("span", { class: "log-time", title: ms !== null ? new Date(ms).toLocaleString() : "" }, logTime(ms)),
                h("span", { class: "log-step" }, STEP_LABELS[e.step] || e.step || ""),
                h("span", { class: "log-note" }, e.note || ""),
              );
            }),
          ),
          { testid: "pr-review-log" },
        )
      : null,
  );
}

function mdBlock(text, emptyText) {
  if (!text || !String(text).trim()) return h("div", { class: "muted" }, emptyText || "Not provided.");
  return h("div", { class: "md", html: markdownToHtml(text) });
}

function ticketView(t) {
  if (!t || (!t.id && !t.title)) return h("div", { class: "muted" }, "No linked ticket found.");
  const url = safeUrl(t.url);
  // Popups opened from this sandboxed frame inherit the sandbox; external
  // trackers (GitHub, Jira, Linear) still render fine there.
  const link = (cls, kids) =>
    url
      ? h("a", { class: cls, href: url, target: "_blank", rel: "noopener noreferrer" }, kids)
      : h("span", { class: cls }, kids);
  return h(
    "div",
    { class: "ticket" },
    t.id ? link("ticket-id", [t.id]) : null,
    t.title ? (t.id ? h("span", { class: "ticket-title" }, t.title) : link("ticket-title", [t.title])) : null,
    url
      ? h(
          "a",
          { class: "link-btn", href: url, target: "_blank", rel: "noopener noreferrer", "aria-label": "Open ticket" },
          icon("external"),
        )
      : null,
  );
}

function confMeter(c) {
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  const bar = h("i");
  bar.style.width = pct + "%";
  return h(
    "span",
    { class: "conf conf-" + confidenceLevel(c), title: "Confidence " + pct + "%", testid: "pr-review-confidence" },
    h("span", { class: "conf-bar", "aria-hidden": "true" }, bar),
    pct + "%",
  );
}

// `ctx` = {r, triage, ignored}: with `triage` set the card carries the
// Ignore / Restore and Edit comment controls; `f._index` / `f._comment` come
// from splitTriage.
function findingCard(f, sev, ctx) {
  const reviewers = f.reviewers || [];
  const loc = formatLocation(f);
  const praise = sev === "praise";
  const triage = !!(ctx && ctx.triage);
  const ignored = triage && ctx.ignored;
  const idx = f._index;
  const editing = triage && !ignored && S.editing[idx] !== undefined;
  const edited = triage && !!f._comment;
  const locked = triage && triageLocked(ctx.r);
  const actions = triage
    ? h(
        "div",
        { class: "factions" },
        !ignored && !editing
          ? h(
              "button",
              {
                class: "btn btn-sm btn-quiet",
                type: "button",
                testid: "pr-review-finding-edit",
                "data-index": idx,
                disabled: locked,
                title: "Change the comment posted for this finding",
                onclick: () => startEdit(f),
              },
              icon("pencil"),
              "Edit comment",
            )
          : null,
        h(
          "button",
          {
            class: "btn btn-sm btn-quiet",
            type: "button",
            testid: "pr-review-finding-ignore",
            "data-index": idx,
            "data-ignored": String(!!ignored),
            "data-fk": "ignore-" + idx,
            disabled: locked,
            title: ignored
              ? "Include this finding in the published review again"
              : "Leave this finding out of the published review",
            onclick: () => saveTriage(ctx.r, idx, { ignored: !ignored }),
          },
          icon(ignored ? "eye" : "eyeOff"),
          ignored ? "Restore" : "Ignore",
        ),
      )
    : null;
  return h(
    "article",
    {
      class: "finding sev-l-" + sev + (ignored ? " is-ignored" : "") + (edited || editing ? " is-edited" : ""),
      testid: praise ? "pr-review-praise-item" : "pr-review-finding",
      "data-severity": sev,
      "data-index": idx,
      "data-ignored": triage ? String(!!ignored) : null,
    },
    h(
      "div",
      { class: "fhead" },
      praise
        ? h("span", { class: "sev sev-praise" }, icon("star"), "Praise")
        : h("span", { class: "sev sev-" + sev }, SEVERITY_LABELS[sev]),
      h("div", { class: "ftitle", html: inlineMarkdown(f.title || "Untitled finding") }),
      edited
        ? h(
            "span",
            {
              class: "edited-tag",
              testid: "pr-review-finding-edited",
              title: "Your comment replaces the finding's text when published",
            },
            icon("pencil"),
            "edited",
          )
        : null,
      typeof f.confidence === "number" ? confMeter(f.confidence) : null,
    ),
    loc ? h("div", null, h("span", { class: "floc", title: loc }, icon("file"), loc)) : null,
    editing ? commentEditor(ctx.r, f, locked) : null,
    edited && !editing
      ? h(
          "div",
          { class: "fcomment", testid: "pr-review-finding-comment" },
          h("div", { class: "fsugg-label" }, icon("comment"), "Your comment"),
          h("div", { class: "md", html: markdownToHtml(f._comment) }),
        )
      : null,
    f.detail ? h("div", { class: "md fdetail", html: markdownToHtml(f.detail) }) : null,
    f.suggestion
      ? h(
          "div",
          { class: "fsugg" },
          h("div", { class: "fsugg-label" }, icon("bulb"), "Suggestion"),
          // Prose (with inline `code` or fences) renders as markdown; a bare
          // multi-line snippet with no fences is code verbatim.
          f.suggestion.includes("\n") && !f.suggestion.includes("```")
            ? h("pre", { class: "code" }, f.suggestion)
            : h("div", { class: "md", html: markdownToHtml(f.suggestion) }),
        )
      : null,
    reviewers.length || actions
      ? h(
          "div",
          { class: "ffoot" },
          reviewers.length >= 2
            ? h(
                "span",
                {
                  class: "consensus",
                  title: "Raised independently by " + reviewers.length + " reviewers",
                  testid: "pr-review-consensus",
                },
                icon("users"),
                "Consensus",
              )
            : null,
          reviewers.map((rv) => h("span", { class: "rchip" }, reviewerLabel(rv))),
          actions,
        )
      : null,
  );
}

// The Conventional Comments label the backend puts in front of this
// finding's comment ("issue (blocking)", "nitpick", …), from the preview.
function previewLabel(index) {
  const p = S.pub.preview;
  if (!p) return null;
  const hit = (p.comments || []).concat(p.body_items || []).find((c) => c.index === index);
  return hit ? hit.label : null;
}

function commentEditor(r, f, locked) {
  const idx = f._index;
  const label = previewLabel(idx);
  const ta = h("textarea", {
    class: "textarea",
    rows: "5",
    "aria-label": "Comment for this finding",
    testid: "pr-review-finding-comment-input",
    "data-index": idx,
    "data-fk": "edit-" + idx,
    value: S.editing[idx],
    disabled: locked,
    oninput: () => {
      S.editing[idx] = ta.value;
    },
    onkeydown: (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancelEdit(idx);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveEdit(r, f);
      }
    },
  });
  return h(
    "div",
    { class: "fedit", testid: "pr-review-finding-editor" },
    h("div", { class: "fsugg-label" }, icon("pencil"), "Comment posted for this finding"),
    ta,
    h(
      "div",
      { class: "fedit-bar" },
      h(
        "span",
        { class: "field-hint" },
        label
          ? ["Posted as “", h("b", null, label + ":"), " …” — the label is added for you."]
          : "The comment label is added for you.",
      ),
      h("span", { class: "spacer" }),
      f._comment
        ? h(
            "button",
            {
              class: "link-btn",
              type: "button",
              testid: "pr-review-finding-comment-revert",
              disabled: locked,
              onclick: () => {
                delete S.editing[idx];
                saveTriage(r, idx, { comment: null }, () => {
                  S.editing[idx] = ta.value;
                });
              },
            },
            icon("rerun"),
            "Use original text",
          )
        : null,
      h(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          testid: "pr-review-finding-comment-cancel",
          onclick: () => cancelEdit(idx),
        },
        "Cancel",
      ),
      h(
        "button",
        {
          class: "btn btn-sm btn-primary",
          type: "button",
          testid: "pr-review-finding-comment-save",
          disabled: locked,
          onclick: () => saveEdit(r, f),
        },
        "Save",
      ),
    ),
  );
}

// ── triage ───────────────────────────────────────────────────────────────────

// A publish reads the triage, so it is frozen while one posts or starts.
const triageLocked = (r) => publishRunning(r) || S.pub.posting;

let triageSeq = 0;

// Optimistic: the overlay shows the change at once; a failed save drops it
// again (rollback), runs `onError`, and says why.
async function saveTriage(r, index, patch, onError) {
  const k = String(index);
  const token = ++triageSeq;
  const prev = triageEntry(r.triage, S.triageOverlay, index);
  S.triageOverlay[k] = Object.assign({}, prev, patch, { _t: token });
  redrawDetail();
  const settle = () => {
    if (S.triageOverlay[k] && S.triageOverlay[k]._t === token) delete S.triageOverlay[k];
  };
  try {
    const res = await postJSON(P + "/triage", Object.assign({ id: r.id, index }, patch));
    if (S.detailFor !== r.id) return;
    settle();
    if (res && res.review) {
      S.detail = res.review;
      detailSig = JSON.stringify(res.review);
      redrawDetail();
      maybeLoadPreview(res.review);
    } else {
      refresh();
    }
  } catch (e) {
    if (S.detailFor !== r.id) return;
    settle();
    if (onError) onError();
    redrawDetail();
    toast(e.message, "error");
  }
}

function startEdit(f) {
  S.editing[f._index] = f._comment || defaultComment(f);
  redrawDetail("edit-" + f._index);
}

function cancelEdit(idx) {
  delete S.editing[idx];
  redrawDetail("ignore-" + idx);
}

// Saving the finding's own text (or nothing) clears the override.
function saveEdit(r, f) {
  const idx = f._index;
  const draft = S.editing[idx] === undefined ? "" : S.editing[idx];
  const text = draft.trim();
  const comment = !text || text === defaultComment(f).trim() ? null : text;
  delete S.editing[idx];
  if (comment === (f._comment || null)) {
    redrawDetail("ignore-" + idx);
    return;
  }
  saveTriage(r, idx, { comment }, () => {
    S.editing[idx] = draft;
  });
}

// ── publish ──────────────────────────────────────────────────────────────────

// A function declaration: S is initialised with it at the top of the file.
function newPub() {
  return {
    decision: null, // the user's pick — never pre-selected
    body: null, // user-edited body; null = follow the preview's default
    preview: null,
    previewKey: null,
    previewErr: null,
    previewLoading: false,
    posting: false,
  };
}

// The preview depends on the triage, so it is re-fetched whenever that changes.
const previewKey = (r) => r.id + "|" + JSON.stringify(r.triage || {});

function maybeLoadPreview(r) {
  if (!r || r.status !== "done" || !r.result || r.id !== S.detailFor) return;
  const key = previewKey(r);
  if (key === S.pub.previewKey) return;
  loadPreview(r, key);
}

async function loadPreview(r, key) {
  S.pub.previewKey = key;
  S.pub.previewLoading = true;
  try {
    const p = await getJSON(P + "/publish-preview?id=" + encodeURIComponent(r.id));
    if (S.pub.previewKey !== key) return;
    S.pub.preview = p;
    S.pub.previewErr = null;
  } catch (e) {
    if (S.pub.previewKey !== key) return;
    S.pub.previewErr = e.message || "Couldn't load the preview.";
  }
  S.pub.previewLoading = false;
  redrawDetail();
}

const currentBody = () => (S.pub.body !== null ? S.pub.body : (S.pub.preview && S.pub.preview.body) || "");

const DECISION_ICON = { approve: "check", request_changes: "alert", comment: "comment" };
const DECISION_VERB = { approve: "approves", request_changes: "requests changes on", comment: "comments on" };

async function doPublish(r, decision, body) {
  if (!decision || S.pub.posting || publishRunning(r)) return;
  const p = S.pub.preview;
  const ok = await confirmDialog({
    title: "Publish to GitHub?",
    message:
      "This posts a review that " +
      DECISION_VERB[decision] +
      " the pull request for " +
      r.branch +
      (p ? " — " + previewCaption(p) + "." : ".") +
      " Everyone with access to the pull request will see it.",
    confirmLabel: "Post: " + DECISION_LABELS[decision],
  });
  if (!ok) return;
  S.pub.posting = true;
  redrawDetail();
  try {
    const res = await postJSON(P + "/publish", { id: r.id, decision, body });
    if (S.detailFor === r.id) {
      S.pub.decision = null; // a later re-publish is a fresh choice
      if (res && res.review) {
        S.detail = res.review;
        detailSig = JSON.stringify(res.review);
      }
    }
    toast("Publish session started");
  } catch (e) {
    toast(e.message, "error");
  }
  S.pub.posting = false;
  redrawDetail();
  refresh();
}

function publishCard(r) {
  const pub = r.publish || null;
  const running = publishRunning(r);
  const busy = running || S.pub.posting;
  const prev = S.pub.preview;
  const suggested = verdictOf(r);

  const reason = h("span", { class: "form-actions-reason", testid: "pr-review-publish-reason", "aria-live": "polite" });
  const startBtn = h(
    "button",
    {
      class: "btn btn-primary",
      type: "button",
      testid: "pr-review-publish-start",
      onclick: () => doPublish(r, S.pub.decision, currentBody()),
    },
    S.pub.posting ? h("span", { class: "spin" }, icon("loader")) : icon("send"),
    S.pub.posting ? "Starting…" : "Start publish session",
  );
  const resetBtn = h(
    "button",
    {
      class: "link-btn",
      type: "button",
      testid: "pr-review-publish-body-reset",
      onclick: () => {
        S.pub.body = null;
        ta.value = currentBody();
        sync();
      },
    },
    icon("rerun"),
    "Reset to generated",
  );
  const ta = h("textarea", {
    class: "textarea publish-body",
    id: "pr-review-publish-body",
    rows: "7",
    testid: "pr-review-publish-body",
    "data-fk": "publish-body",
    value: currentBody(),
    placeholder: prev ? "Optional — a short summary posted with the review." : "Loading the generated summary…",
    disabled: busy,
    oninput: () => {
      S.pub.body = ta.value;
      sync();
    },
  });
  function sync() {
    const why = S.pub.posting ? null : publishBlockReason({ decision: S.pub.decision, body: currentBody(), running });
    startBtn.disabled = busy || !!why;
    reason.textContent = why || "";
    reason.hidden = !why;
    resetBtn.hidden = busy || S.pub.body === null || !prev || S.pub.body === (prev.body || "");
  }

  const radios = h("div", {
    class: "decision-group",
    role: "radiogroup",
    "aria-labelledby": "pr-review-decision-label",
    testid: "pr-review-decision",
  });
  for (const d of DECISIONS) {
    radios.appendChild(
      h(
        "label",
        { class: "decision-opt decision-" + d.id, "data-decision": d.id },
        h("input", {
          type: "radio",
          name: "pr-review-decision",
          value: d.id,
          testid: "pr-review-decision-" + d.id,
          "data-fk": "decision-" + d.id,
          checked: S.pub.decision === d.id,
          disabled: busy,
          onchange: () => {
            S.pub.decision = d.id;
            sync();
          },
        }),
        h(
          "span",
          { class: "decision-text" },
          h("span", { class: "decision-label" }, icon(DECISION_ICON[d.id]), d.label),
          h("span", { class: "decision-hint" }, d.hint),
        ),
      ),
    );
  }

  const card = h(
    "section",
    {
      class: "card publish-card" + (busy ? " is-busy" : ""),
      testid: "pr-review-publish",
      "aria-labelledby": "pr-review-publish-title",
    },
    h(
      "div",
      { class: "publish-head" },
      h("span", { class: "publish-icon" }, icon("send")),
      h(
        "div",
        { class: "publish-head-text" },
        h("h2", { id: "pr-review-publish-title" }, "Publish review"),
        h(
          "p",
          null,
          "Triage the findings below, then post your review to the pull request on GitHub. The decision is yours",
          suggested ? [" — the model only suggests ", h("b", null, VERDICT_LABELS[suggested] || suggested), "."] : ".",
        ),
      ),
    ),
    pub ? publishStatus(r, pub) : null,
    h(
      "div",
      { class: "field-label", id: "pr-review-decision-label" },
      "Your decision",
      h("span", { class: "req" }, "*"),
    ),
    radios,
    h(
      "div",
      { class: "field publish-field" },
      h(
        "div",
        { class: "publish-label-row" },
        h("label", { class: "field-label", for: "pr-review-publish-body" }, "Review body"),
        resetBtn,
      ),
      ta,
    ),
    previewBlock(),
    h("div", { class: "publish-actions" }, startBtn, reason),
  );
  sync();
  return card;
}

function previewBlock() {
  const p = S.pub.preview;
  const wrap = h("div", {
    class: "publish-preview",
    testid: "pr-review-publish-preview",
    "data-loading": S.pub.previewLoading ? "true" : null,
  });
  if (!p) {
    if (S.pub.previewErr) {
      append(wrap, [
        h("span", { class: "preview-err" }, icon("alert"), "Couldn't load the preview: " + S.pub.previewErr),
        h(
          "button",
          {
            class: "link-btn",
            type: "button",
            onclick: () => {
              S.pub.previewKey = null;
              maybeLoadPreview(S.detail);
            },
          },
          icon("rerun"),
          "Try again",
        ),
      ]);
    } else {
      append(wrap, [
        h("span", { class: "spin" }, icon("loader")),
        h("span", { class: "muted" }, "Preparing the preview…"),
      ]);
    }
    return wrap;
  }
  const items = (p.comments || [])
    .map((c) => ({
      index: c.index,
      inline: true,
      where: formatLocation({ file: c.path, line: c.line, end_line: c.end_line }) || c.path,
      text: c.text,
    }))
    .concat((p.body_items || []).map((b) => ({ index: b.index, inline: false, text: b.text })));
  const caption = h(
    "span",
    { class: "preview-caption", testid: "pr-review-publish-preview-caption" },
    previewCaption(p),
  );
  const updating = S.pub.previewLoading
    ? h("span", { class: "spin preview-updating", title: "Updating…" }, icon("loader"))
    : null;
  if (!items.length) {
    append(wrap, [icon("comment"), caption, updating, h("span", { class: "muted" }, "— only the body is posted.")]);
    return wrap;
  }
  wrap.appendChild(
    fold(
      "pubPreview",
      [caption, updating],
      h(
        "ul",
        { class: "preview-list" },
        items.map((it) =>
          h(
            "li",
            {
              class: "preview-item",
              testid: "pr-review-publish-preview-item",
              "data-index": it.index,
              "data-kind": it.inline ? "inline" : "body",
            },
            h(
              "div",
              { class: "preview-where" },
              it.inline
                ? [icon("file"), h("span", { class: "mono" }, it.where)]
                : [icon("comment"), "In the review body"],
            ),
            h("div", { class: "md preview-text", html: markdownToHtml(it.text || "") }),
          ),
        ),
      ),
      { testid: "pr-review-publish-preview-list" },
    ),
  );
  return wrap;
}

function publishStatus(r, pub) {
  const st = pub.status;
  const started = toMs(pub.started_at);
  const finished = toMs(pub.finished_at);
  const sessionBtn = pub.session_id
    ? h(
        "button",
        {
          class: "btn btn-sm",
          type: "button",
          testid: "pr-review-publish-session",
          onclick: () => openSession(pub.session_id),
        },
        icon("session"),
        "Open session",
      )
    : null;
  const box = h("div", {
    class: "publish-status ps-" + st,
    testid: "pr-review-publish-status",
    "data-status": st,
    role: "status",
  });
  if (st === "running") {
    append(box, [
      h("span", { class: "ps-icon spin" }, icon("loader")),
      h(
        "div",
        { class: "ps-main" },
        h("div", { class: "ps-title" }, "Posting to GitHub…"),
        h(
          "div",
          { class: "ps-sub" },
          DECISION_LABELS[pub.decision] || pub.decision,
          started !== null ? [" · started ", relEl(started)] : null,
        ),
      ),
      h("div", { class: "ps-actions" }, sessionBtn),
    ]);
  } else if (st === "posted") {
    const url = safeUrl(pub.pr_url);
    const n = pub.comments_posted;
    append(box, [
      h("span", { class: "ps-icon" }, icon("check")),
      h(
        "div",
        { class: "ps-main" },
        h("div", { class: "ps-title" }, "Posted — " + (DECISION_DONE[pub.decision] || "review")),
        h(
          "div",
          { class: "ps-sub" },
          typeof n === "number"
            ? n === 0
              ? "No inline comments"
              : n + (n === 1 ? " inline comment" : " inline comments")
            : null,
          typeof n === "number" && finished !== null ? " · " : null,
          finished !== null ? relEl(finished) : null,
        ),
      ),
      h(
        "div",
        { class: "ps-actions" },
        url
          ? h(
              "a",
              {
                class: "btn btn-sm",
                href: url,
                target: "_blank",
                rel: "noopener noreferrer",
                testid: "pr-review-publish-pr-link",
              },
              icon("external"),
              "View on GitHub",
            )
          : null,
        sessionBtn,
      ),
    ]);
  } else if (st === "failed") {
    append(box, [
      h("span", { class: "ps-icon" }, icon("alert")),
      h(
        "div",
        { class: "ps-main" },
        h("div", { class: "ps-title" }, "Post failed"),
        h(
          "pre",
          { class: "ps-error", testid: "pr-review-publish-error" },
          pub.error || "The publish session stopped without posting.",
        ),
      ),
      h(
        "div",
        { class: "ps-actions" },
        h(
          "button",
          {
            class: "btn btn-sm btn-primary",
            type: "button",
            testid: "pr-review-publish-retry",
            disabled: S.pub.posting || !pub.decision,
            title: pub.decision
              ? "Post again: " + (DECISION_LABELS[pub.decision] || pub.decision) + ", same body"
              : null,
            onclick: () => doPublish(r, pub.decision, typeof pub.body === "string" ? pub.body : currentBody()),
          },
          icon("rerun"),
          "Retry",
        ),
        sessionBtn,
      ),
    ]);
  }
  return box;
}

function resultSections(r) {
  const res = r.result;
  // Triage + publish open once the review is done; ignored findings leave
  // the severity groups for a collapsed group of their own.
  const triage = r.status === "done";
  const split = triage ? splitTriage(res.findings, r.triage, S.triageOverlay) : splitTriage(res.findings, null, null);
  const ctx = { r, triage, ignored: false };
  const groups = groupFindings(split.kept);
  const changeCount = SEVERITIES.reduce((n, s) => n + groups[s].length, 0);
  const out = [];

  out.push(
    h(
      "div",
      { class: "overview-grid" },
      h(
        "div",
        { class: "card span-2", testid: "pr-review-summary" },
        h("div", { class: "card-title" }, "Summary"),
        mdBlock(res.summary),
      ),
      h(
        "div",
        { class: "card", testid: "pr-review-why" },
        h("div", { class: "card-title" }, "Why it's needed"),
        mdBlock(res.why, "Not stated."),
      ),
      h(
        "div",
        { class: "card", testid: "pr-review-ticket" },
        h("div", { class: "card-title" }, "Ticket"),
        ticketView(res.ticket),
      ),
    ),
  );
  if (triage) out.push(publishCard(r));

  // Recommended changes, grouped by severity, with filter toggles.
  const groupsBox = h("div", { testid: "pr-review-groups" });
  const consensusTotal = SEVERITIES.reduce(
    (n, s) => n + groups[s].filter((f) => (f.reviewers || []).length >= 2).length,
    0,
  );
  const filters = h("div", { class: "filters", role: "group", "aria-label": "Filter findings" });
  for (const s of SEVERITIES) {
    const n = groups[s].length;
    const b = h(
      "button",
      {
        class: "chip-toggle sw-" + s,
        type: "button",
        "aria-pressed": String(n > 0 && S.filters.has(s)),
        disabled: n === 0,
        testid: "pr-review-filter",
        "data-severity": s,
        onclick: () => {
          if (S.filters.has(s)) S.filters.delete(s);
          else S.filters.add(s);
          b.setAttribute("aria-pressed", String(S.filters.has(s)));
          drawGroups();
        },
      },
      h("span", { class: "swatch", "aria-hidden": "true" }),
      SEVERITY_LABELS[s],
      h("span", { class: "n" }, String(n)),
    );
    filters.appendChild(b);
  }
  if (consensusTotal > 0) {
    const cb = h(
      "button",
      {
        class: "chip-toggle",
        type: "button",
        "aria-pressed": String(S.consensusOnly),
        testid: "pr-review-filter-consensus",
        title: "Only findings raised by two or more reviewers",
        onclick: () => {
          S.consensusOnly = !S.consensusOnly;
          cb.setAttribute("aria-pressed", String(S.consensusOnly));
          drawGroups();
        },
      },
      icon("users"),
      "Consensus only",
      h("span", { class: "n" }, String(consensusTotal)),
    );
    filters.appendChild(cb);
  }

  function drawGroups() {
    clear(groupsBox);
    if (!changeCount) {
      const allIgnored = split.ignored.some((f) => f.kind !== "praise");
      groupsBox.appendChild(
        allIgnored
          ? h("div", { class: "none-note", testid: "pr-review-no-changes" }, "Every recommended change is ignored.")
          : h(
              "div",
              { class: "none-note ok", testid: "pr-review-no-changes" },
              icon("check"),
              "No changes recommended.",
            ),
      );
      return;
    }
    let shown = 0;
    for (const s of SEVERITIES) {
      if (!S.filters.has(s)) continue;
      const items = groups[s].filter((f) => !S.consensusOnly || (f.reviewers || []).length >= 2);
      if (!items.length) continue;
      shown += items.length;
      groupsBox.appendChild(
        h(
          "div",
          { class: "group-head", testid: "pr-review-group", "data-severity": s },
          h("span", { class: "sev sev-" + s }, SEVERITY_LABELS[s]),
          h("span", { class: "muted" }, items.length + (items.length === 1 ? " finding" : " findings")),
          h("span", { class: "line" }),
        ),
      );
      for (const f of items) groupsBox.appendChild(findingCard(f, s, ctx));
    }
    if (!shown) groupsBox.appendChild(h("div", { class: "none-note" }, "No findings match the current filters."));
  }
  drawGroups();

  out.push(
    h(
      "section",
      { testid: "pr-review-changes" },
      h(
        "div",
        { class: "section-head" },
        h("h2", null, "Recommended changes", h("span", { class: "count-chip" }, String(changeCount))),
        changeCount ? filters : null,
      ),
      groupsBox,
    ),
  );

  if (groups.praise.length) {
    out.push(
      h(
        "section",
        { testid: "pr-review-praise" },
        h(
          "div",
          { class: "section-head" },
          h("h2", null, "Praise", h("span", { class: "count-chip" }, String(groups.praise.length))),
        ),
        groups.praise.map((f) => findingCard(f, "praise", ctx)),
      ),
    );
  }

  if (split.ignored.length) {
    const n = split.ignored.length;
    out.push(h("div", { class: "section-head" }));
    out.push(
      fold(
        "ignored",
        ["Ignored ", h("span", { class: "count-chip" }, String(n))],
        h(
          "div",
          { class: "ignored-list" },
          h("div", { class: "field-hint" }, "Left out of the published review. Restore one to include it again."),
          split.ignored.map((f) =>
            findingCard(f, f.kind === "praise" ? "praise" : SEVERITIES.includes(f.severity) ? f.severity : "minor", {
              r,
              triage,
              ignored: true,
            }),
          ),
        ),
        { standalone: true, testid: "pr-review-ignored-group" },
      ),
    );
  }

  const failed = res.reviewers_failed || [];
  const dropped = res.dropped || [];
  if ((failed.length || dropped.length) && !split.ignored.length) out.push(h("div", { class: "section-head" }));
  if (failed.length) {
    out.push(
      h(
        "div",
        { class: "notice-card", testid: "pr-review-reviewers-failed" },
        icon("alert"),
        h(
          "span",
          null,
          (failed.length === 1 ? "One reviewer" : failed.length + " reviewers") + " didn't finish: ",
          h("b", null, failed.map(reviewerLabel).join(", ")),
          ". The findings above are missing their perspective.",
        ),
      ),
    );
  }
  if (dropped.length) {
    out.push(
      fold(
        "dropped",
        ["Dropped findings ", h("span", { class: "count-chip" }, String(dropped.length))],
        h(
          "div",
          null,
          h("div", { class: "field-hint" }, "Raised by a reviewer but discarded while merging or verifying."),
          h(
            "ul",
            { class: "dropped-list" },
            dropped.map((d) =>
              h(
                "li",
                null,
                h("span", { class: "dr-title" }, d.title || "Untitled"),
                d.reason ? h("span", { class: "dr-reason" }, " — " + d.reason) : null,
              ),
            ),
          ),
        ),
        { standalone: true, testid: "pr-review-dropped" },
      ),
    );
  }
  return out;
}

// ── boot ─────────────────────────────────────────────────────────────────────

if (S.route.view === "review") S.detailFor = S.route.id;
render();
refresh();
