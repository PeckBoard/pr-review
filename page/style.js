// PR review stylesheet, injected by main.js. Tokens mirror Peckboard's own
// design system (web/src/index.css) so the page reads as part of the app.
// Two themes via html[data-theme]; the host passes ?theme=light|dark and
// main.js stamps it (auto falls back to prefers-color-scheme).

export const CSS = `
:root {
  --bg: #f8f9fb;
  --surface: #ffffff;
  --surface2: #f3f4f6;
  --surface3: #e9ebef;
  --surface-hover: #f0f1f4;
  --text: #1a1d23;
  --text2: #4b5563;
  --text3: #616875;
  --accent: hsl(220, 72%, 50%);
  --accent-hover: hsl(220, 72%, 44%);
  --accent-subtle: hsl(220, 60%, 95%);
  --accent-muted: hsl(220, 40%, 88%);
  --ring: hsl(220, 72%, 30%);
  --danger: #dc2626;
  --danger-bg: #fef2f2;
  --danger-border: #fecaca;
  --success: #059669;
  --success-bg: #ecfdf5;
  --success-border: #a7f3d0;
  --warning: #a16207;
  --warning-bg: #fffbeb;
  --warning-border: #fde68a;
  --orange: #c2410c;
  --orange-bg: #fff7ed;
  --orange-border: #fed7aa;
  --border: #e5e7eb;
  --border-strong: #d1d5db;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.08), 0 4px 10px rgba(0, 0, 0, 0.04);
  --shadow-overlay: 0 16px 48px rgba(0, 0, 0, 0.14), 0 4px 12px rgba(0, 0, 0, 0.06);
  --backdrop: rgba(15, 17, 23, 0.38);
  --font: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  --mono: "SF Mono", "Fira Code", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace;
}
html[data-theme="light"] { color-scheme: light; }
html[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0f1117;
  --surface: #1a1d27;
  --surface2: #22252f;
  --surface3: #2a2d38;
  --surface-hover: #2f323e;
  --text: #e5e7eb;
  --text2: #9ca3af;
  --text3: #8f97a5;
  --accent: hsl(220, 65%, 62%);
  --accent-hover: hsl(220, 65%, 56%);
  --accent-subtle: hsl(220, 30%, 16%);
  --accent-muted: hsl(220, 25%, 22%);
  --ring: hsl(220, 65%, 68%);
  --danger: #f87171;
  --danger-bg: rgba(239, 68, 68, 0.1);
  --danger-border: rgba(239, 68, 68, 0.3);
  --success: #34d399;
  --success-bg: rgba(16, 185, 129, 0.1);
  --success-border: rgba(16, 185, 129, 0.3);
  --warning: #fbbf24;
  --warning-bg: rgba(245, 158, 11, 0.1);
  --warning-border: rgba(245, 158, 11, 0.3);
  --orange: #fb923c;
  --orange-bg: rgba(249, 115, 22, 0.1);
  --orange-border: rgba(249, 115, 22, 0.3);
  --border: #2a2d38;
  --border-strong: #3a3d48;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.4), 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.4), 0 4px 10px rgba(0, 0, 0, 0.2);
  --shadow-overlay: 0 16px 48px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.3);
  --backdrop: rgba(0, 0, 0, 0.55);
}

* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  font: 14px/1.5 var(--font);
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}
button, input, select, textarea { font: inherit; color: inherit; }
a { color: var(--accent); }
.mono { font-family: var(--mono); }
.muted { color: var(--text3); }
[hidden] { display: none !important; }
svg.ic { width: 16px; height: 16px; flex: none; }

.page { max-width: 1120px; margin: 0 auto; padding: 24px 24px 64px; }
@media (max-width: 640px) { .page { padding: 16px 12px 48px; } }

/* ── buttons ────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 34px; padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  color: var(--text);
  font-size: 13px; font-weight: 550;
  cursor: pointer;
  white-space: nowrap;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, box-shadow 150ms ease;
}
.btn:hover:not(:disabled) { background: var(--surface-hover); }
.btn:focus-visible, .icon-btn:focus-visible, .chip-toggle:focus-visible, .rv-row:focus-visible,
.link-btn:focus-visible, summary:focus-visible {
  outline: 2px solid var(--ring); outline-offset: 2px;
}
.btn:disabled { opacity: .5; cursor: default; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn-danger { background: var(--danger); border-color: var(--danger); color: #fff; }
.btn-danger:hover:not(:disabled) { filter: brightness(.94); background: var(--danger); }
.btn-ghost-danger { color: var(--danger); border-color: var(--danger-border); }
.btn-ghost-danger:hover:not(:disabled) { background: var(--danger-bg); }
.btn-sm { height: 28px; padding: 0 10px; font-size: 12.5px; }
.icon-btn {
  width: 30px; height: 30px;
  display: inline-grid; place-items: center;
  border-radius: 7px; border: 1px solid transparent;
  background: transparent; color: var(--text3); cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}
.icon-btn:hover, .icon-btn[aria-expanded="true"] { background: var(--surface3); color: var(--text); }
.link-btn {
  display: inline-flex; align-items: center; gap: 6px;
  border: 0; background: none; padding: 0;
  color: var(--text2); cursor: pointer; font-size: 13px; text-decoration: none;
}
.link-btn:hover { color: var(--accent); }

/* ── page header ────────────────────────────────────────────────────── */
.view-head { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
.view-head-text { flex: 1; min-width: 240px; }
.view-head h1 { font-size: 22px; line-height: 1.25; margin: 0; letter-spacing: -0.01em; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.view-head p { margin: 4px 0 0; color: var(--text2); font-size: 13.5px; }
.view-head-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.count-chip {
  font-size: 12px; font-weight: 600; color: var(--text2);
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 999px; padding: 1px 9px;
}
.back-link { margin-bottom: 14px; }

.banner {
  display: flex; align-items: center; gap: 8px;
  border: 1px solid var(--warning-border); background: var(--warning-bg); color: var(--warning);
  border-radius: 8px; padding: 8px 12px; margin-bottom: 14px; font-size: 13px;
}

/* ── review list ────────────────────────────────────────────────────── */
.rv-table { display: flex; flex-direction: column; gap: 8px; }
.rv-cols, .rv-row {
  display: grid;
  grid-template-columns: minmax(200px, 2.1fr) minmax(190px, 1.5fr) minmax(130px, 1fr) minmax(150px, 1.2fr) 34px;
  gap: 16px;
  align-items: center;
}
.rv-cols {
  padding: 0 16px; font-size: 11.5px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .05em; color: var(--text3);
}
.rv-row {
  position: relative;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 14px 16px;
  cursor: pointer;
  box-shadow: var(--shadow-sm);
  transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease;
}
.rv-row:hover { border-color: var(--border-strong); box-shadow: var(--shadow); }
.rv-row.is-running { border-left: 3px solid var(--accent); padding-left: 14px; }
.rv-row.is-failed { border-left: 3px solid var(--danger); padding-left: 14px; }
.rv-title { display: flex; align-items: center; gap: 6px; min-width: 0; font-weight: 600; }
.rv-branch { font-family: var(--mono); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.rv-arrow { color: var(--text3); flex: none; }
.rv-base { font-family: var(--mono); font-size: 12.5px; color: var(--text2); font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rv-base.auto { font-family: var(--font); font-style: italic; color: var(--text3); }
.rv-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; font-size: 12.5px; color: var(--text3); min-width: 0; }
.rv-meta > span { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.rv-meta svg.ic { width: 13px; height: 13px; }
.rv-folder { color: var(--text2); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-progress { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.rv-progress-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.rv-caption { font-size: 12px; color: var(--text3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rv-chips, .rv-outcome { display: flex; flex-wrap: wrap; gap: 5px; align-items: center; min-width: 0; }
.rv-menu { position: relative; justify-self: end; }
@media (max-width: 900px) {
  .rv-cols { display: none; }
  .rv-row { grid-template-columns: 1fr 34px; gap: 10px; }
  .rv-row > .rv-cell { grid-column: 1; }
  .rv-row > .rv-menu { grid-column: 2; grid-row: 1; align-self: start; }
}

/* ── status pill ────────────────────────────────────────────────────── */
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  height: 22px; padding: 0 9px;
  border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap;
  border: 1px solid transparent;
}
.pill .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex: none; }
.pill-queued { color: var(--text2); background: var(--surface2); border-color: var(--border); }
.pill-running { color: var(--accent); background: var(--accent-subtle); border-color: var(--accent-muted); }
.pill-running .dot { animation: pulse-dot 1.4s ease-in-out infinite; box-shadow: 0 0 0 0 currentColor; }
.pill-done { color: var(--success); background: var(--success-bg); border-color: var(--success-border); }
.pill-failed { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }
.pill-cancelled { color: var(--text3); background: var(--surface2); border-color: var(--border); }
@keyframes pulse-dot {
  0% { transform: scale(.85); opacity: .7; }
  50% { transform: scale(1.15); opacity: 1; }
  100% { transform: scale(.85); opacity: .7; }
}

/* ── verdict ────────────────────────────────────────────────────────── */
.verdict {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 9px; border-radius: 6px;
  font-size: 12px; font-weight: 650; white-space: nowrap; border: 1px solid transparent;
}
.verdict svg.ic { width: 13px; height: 13px; }
.verdict-approve { color: var(--success); background: var(--success-bg); border-color: var(--success-border); }
.verdict-approve_with_comments { color: var(--accent); background: var(--accent-subtle); border-color: var(--accent-muted); }
.verdict-request_changes { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }
.verdict-lg { height: 28px; padding: 0 12px; font-size: 13px; }

/* The model's verdict is a suggestion, not a decision: muted + dashed, only
   the icon keeps the verdict's colour. */
.verdict.verdict-suggest {
  color: var(--text2); background: var(--surface2); border: 1px dashed var(--border-strong);
  font-weight: 600;
}
.verdict-suggest .verdict-prefix { color: var(--text3); font-weight: 500; }
.verdict-suggest.verdict-approve svg.ic { color: var(--success); }
.verdict-suggest.verdict-approve_with_comments svg.ic { color: var(--accent); }
.verdict-suggest.verdict-request_changes svg.ic { color: var(--danger); }
.rv-outcome .verdict-suggest { display: inline-block; white-space: normal; height: auto; padding: 2px 8px; line-height: 1.45; font-size: 11.5px; }
.rv-outcome .verdict-suggest svg.ic { width: 12px; height: 12px; vertical-align: -2px; margin-right: 4px; }
.rv-outcome .verdict-suggest .verdict-prefix { margin-right: 4px; }

/* The user's published decision (list rows). */
.pub-chip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 9px; border-radius: 6px;
  font-size: 12px; font-weight: 650; white-space: nowrap; border: 1px solid transparent;
}
.pub-chip svg.ic { width: 13px; height: 13px; }
.pub-running { color: var(--accent); background: var(--accent-subtle); border-color: var(--accent-muted); }
.pub-running svg.ic { animation: spin 1s linear infinite; }
.pub-failed { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }
.pub-posted { color: var(--text); background: var(--surface2); border-color: var(--border-strong); }
.pub-posted.pub-approve { color: var(--success); background: var(--success-bg); border-color: var(--success-border); }
.pub-posted.pub-request_changes { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }
.pub-posted.pub-comment { color: var(--accent); background: var(--accent-subtle); border-color: var(--accent-muted); }
/* ── severity / praise badges ───────────────────────────────────────── */
.sev {
  display: inline-flex; align-items: center; gap: 4px;
  height: 20px; padding: 0 7px; border-radius: 5px;
  font-size: 11.5px; font-weight: 650; white-space: nowrap; border: 1px solid transparent;
}
.sev b { font-weight: 750; }
.sev-blocker { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-border); }
.sev-major { color: var(--orange); background: var(--orange-bg); border-color: var(--orange-border); }
.sev-minor { color: var(--warning); background: var(--warning-bg); border-color: var(--warning-border); }
.sev-nit { color: var(--text2); background: var(--surface2); border-color: var(--border); }
.sev-praise { color: var(--success); background: var(--success-bg); border-color: var(--success-border); }
.sev svg.ic { width: 12px; height: 12px; }

/* ── stepper ────────────────────────────────────────────────────────── */
.mini-steps { display: flex; gap: 3px; flex: 1; min-width: 70px; max-width: 160px; }
.mini-steps i { flex: 1; height: 5px; border-radius: 3px; background: var(--surface3); }
.mini-steps i.done { background: var(--success); }
.mini-steps i.active { background: var(--accent); animation: shimmer 1.4s ease-in-out infinite; }
.mini-steps i.failed { background: var(--danger); }
.mini-steps i.cancelled { background: var(--text3); }
@keyframes shimmer { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }

.stepper { display: flex; align-items: flex-start; margin: 4px 0 6px; padding: 0; list-style: none; }
.step { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 7px; position: relative; min-width: 0; }
.step::before {
  content: ""; position: absolute; top: 12px; right: 50%; width: 100%; height: 2px;
  background: var(--border); z-index: 0;
}
.step:first-child::before { display: none; }
.step.done::before, .step.active::before, .step.failed::before, .step.cancelled::before { background: var(--success); }
.step-dot {
  position: relative; z-index: 1;
  width: 26px; height: 26px; border-radius: 50%;
  display: grid; place-items: center;
  background: var(--surface); border: 2px solid var(--border-strong); color: var(--text3);
  font-size: 11px; font-weight: 700;
}
.step-dot svg.ic { width: 14px; height: 14px; }
.step.done .step-dot { background: var(--success); border-color: var(--success); color: #fff; }
.step.active .step-dot { border-color: var(--accent); color: var(--accent); box-shadow: 0 0 0 4px var(--accent-subtle); }
.step.active .step-dot::after {
  content: ""; position: absolute; inset: -6px; border-radius: 50%;
  border: 2px solid var(--accent); opacity: 0; animation: ring 1.6s ease-out infinite;
}
.step.failed .step-dot { background: var(--danger); border-color: var(--danger); color: #fff; }
.step.cancelled .step-dot { background: var(--surface3); border-color: var(--text3); color: var(--text3); }
@keyframes ring { 0% { transform: scale(.8); opacity: .6; } 100% { transform: scale(1.25); opacity: 0; } }
.step-label { font-size: 11.5px; color: var(--text3); text-align: center; line-height: 1.25; padding: 0 2px; }
.step.active .step-label { color: var(--accent); font-weight: 650; }
.step.done .step-label { color: var(--text2); }
.step.failed .step-label { color: var(--danger); font-weight: 650; }
@media (max-width: 640px) { .step-label { display: none; } .step.active .step-label, .step.failed .step-label { display: block; } }

/* ── provider chips ─────────────────────────────────────────────────── */
.pchip {
  display: inline-flex; align-items: center; gap: 5px;
  height: 22px; padding: 0 8px 0 6px; border-radius: 999px;
  font-size: 12px; font-weight: 550; white-space: nowrap;
  background: var(--surface2); border: 1px solid var(--border); color: var(--text2);
}
.pchip svg.ic { width: 12px; height: 12px; }
.pchip-running { color: var(--accent); border-color: var(--accent-muted); background: var(--accent-subtle); }
.pchip-running svg.ic { animation: spin 1s linear infinite; }
.pchip-done { color: var(--success); border-color: var(--success-border); background: var(--success-bg); }
.pchip-failed { color: var(--danger); border-color: var(--danger-border); background: var(--danger-bg); }
.pchip-pending { color: var(--text3); }
@keyframes spin { to { transform: rotate(360deg); } }

/* ── dropdown menu ──────────────────────────────────────────────────── */
.menu {
  position: absolute; top: calc(100% + 4px); right: 0; z-index: 30;
  min-width: 190px; padding: 4px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; box-shadow: var(--shadow-overlay);
  animation: pop 120ms ease-out;
}
.menu.up { top: auto; bottom: calc(100% + 4px); }
.menu-item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 10px; border: 0; border-radius: 6px;
  background: none; text-align: left; font-size: 13px; cursor: pointer; color: var(--text);
}
.menu-item:hover:not(:disabled), .menu-item:focus-visible { background: var(--surface-hover); outline: none; }
.menu-item:disabled { color: var(--text3); cursor: default; }
.menu-item.danger { color: var(--danger); }
.menu-item.danger:hover { background: var(--danger-bg); }
.menu-divider { height: 1px; background: var(--border); margin: 4px 2px; }
@keyframes pop { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: none; } }

/* ── empty / loading ────────────────────────────────────────────────── */
.empty {
  text-align: center; padding: 56px 24px;
  background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 14px;
}
.empty-icon {
  width: 52px; height: 52px; margin: 0 auto 14px; border-radius: 14px;
  display: grid; place-items: center; color: var(--accent); background: var(--accent-subtle);
}
.empty-icon svg.ic { width: 26px; height: 26px; }
.empty h2 { font-size: 17px; margin: 0 0 6px; }
.empty p { margin: 0 auto 18px; max-width: 520px; color: var(--text2); font-size: 13.5px; }
.empty-steps { display: flex; justify-content: center; flex-wrap: wrap; gap: 6px; margin: 0 0 20px; }
.empty-steps span { font-size: 12px; color: var(--text2); background: var(--surface2); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; }
.skeleton {
  height: 72px; border-radius: 12px; border: 1px solid var(--border);
  background: linear-gradient(90deg, var(--surface) 0%, var(--surface2) 50%, var(--surface) 100%);
  background-size: 200% 100%; animation: skel 1.3s ease-in-out infinite;
}
@keyframes skel { from { background-position: 100% 0; } to { background-position: -100% 0; } }

/* ── cards (detail) ─────────────────────────────────────────────────── */
.card {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: var(--shadow-sm);
  padding: 18px 20px; margin-bottom: 14px;
}
.card-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 650; text-transform: uppercase; letter-spacing: .05em;
  color: var(--text3); margin: 0 0 10px;
}
.card-title .count-chip { text-transform: none; letter-spacing: 0; }
.detail-head { display: flex; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
.detail-head-main { flex: 1; min-width: 260px; }
.detail-badges { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
.detail-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 20px; font-weight: 650; margin: 0; line-height: 1.3; }
.detail-title .rv-branch { font-size: 18px; white-space: normal; overflow-wrap: anywhere; }
.detail-title .rv-base { font-size: 16px; }
.detail-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 8px; font-size: 13px; color: var(--text3); }
.detail-meta > span { display: inline-flex; align-items: center; gap: 5px; }
.detail-meta b { color: var(--text2); font-weight: 550; }
.detail-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.section-sub { margin: 16px 0 8px; font-size: 12px; font-weight: 650; color: var(--text3); text-transform: uppercase; letter-spacing: .05em; }

.error-card {
  display: flex; gap: 14px; align-items: flex-start;
  border: 1px solid var(--danger-border); background: var(--danger-bg);
  border-radius: 14px; padding: 16px 18px; margin-bottom: 14px; color: var(--text);
}
.error-card .err-icon { color: var(--danger); margin-top: 2px; }
.error-card .err-icon svg.ic { width: 22px; height: 22px; }
.error-card h3 { margin: 0 0 4px; font-size: 15px; color: var(--danger); }
.error-card .err-main { flex: 1; min-width: 0; }
.error-card pre { margin: 0 0 12px; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); font-size: 12.5px; color: var(--text2); }
.notice-card {
  display: flex; gap: 10px; align-items: center;
  border: 1px solid var(--border); background: var(--surface2); color: var(--text2);
  border-radius: 12px; padding: 12px 16px; margin-bottom: 14px; font-size: 13.5px;
}

/* ── collapsibles ───────────────────────────────────────────────────── */
details.fold { border-top: 1px solid var(--border); margin-top: 14px; padding-top: 10px; }
details.fold.standalone { border: 1px solid var(--border); border-radius: 12px; background: var(--surface); padding: 0; margin: 0 0 14px; box-shadow: var(--shadow-sm); }
details.fold > summary {
  display: flex; align-items: center; gap: 8px; cursor: pointer; list-style: none;
  font-size: 13px; font-weight: 600; color: var(--text2); user-select: none; border-radius: 6px;
}
details.fold.standalone > summary { padding: 12px 16px; }
details.fold > summary::-webkit-details-marker { display: none; }
details.fold > summary .chev { transition: transform 150ms ease; color: var(--text3); }
details.fold[open] > summary .chev { transform: rotate(90deg); }
details.fold > summary:hover { color: var(--text); }
.fold-body { padding-top: 10px; }
details.fold.standalone .fold-body { padding: 0 16px 14px; }

.log { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow: auto; font-size: 12.5px; }
.log li { display: grid; grid-template-columns: 70px 120px 1fr; gap: 10px; padding: 5px 0; border-bottom: 1px dashed var(--border); align-items: baseline; }
.log li:last-child { border-bottom: 0; }
.log-time { font-family: var(--mono); color: var(--text3); font-size: 11.5px; }
.log-step { color: var(--text2); font-weight: 600; font-size: 11.5px; }
.log-note { color: var(--text); overflow-wrap: anywhere; }
@media (max-width: 640px) { .log li { grid-template-columns: 62px 1fr; } .log-step { display: none; } }
.prompt-view { white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); font-size: 12.5px; color: var(--text2); background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; margin: 0; }

/* ── markdown ───────────────────────────────────────────────────────── */
.md { color: var(--text); font-size: 14px; overflow-wrap: anywhere; }
.md p { margin: 0 0 8px; }
.md p:last-child, .md ul:last-child, .md ol:last-child, .md pre:last-child { margin-bottom: 0; }
.md ul, .md ol { margin: 0 0 8px; padding-left: 22px; }
.md li { margin: 2px 0; }
.md .md-h { font-size: 13.5px; margin: 10px 0 4px; }
.md code, .ftitle code {
  font-family: var(--mono); font-size: .9em;
  background: var(--surface2); border: 1px solid var(--border);
  border-radius: 4px; padding: 0 4px;
}
.md pre, pre.code {
  margin: 0 0 8px; padding: 10px 12px; overflow: auto;
  background: var(--surface2); border: 1px solid var(--border); border-radius: 8px;
  font-family: var(--mono); font-size: 12.5px; line-height: 1.5; white-space: pre;
}
.md pre code { background: none; border: 0; padding: 0; font-size: inherit; }
.overview-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.overview-grid > .card { margin-bottom: 0; }
.overview-grid .span-2 { grid-column: 1 / -1; }
@media (max-width: 760px) { .overview-grid { grid-template-columns: 1fr; } }
.ticket { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ticket-id { font-family: var(--mono); font-size: 12.5px; font-weight: 650; color: var(--accent); background: var(--accent-subtle); border: 1px solid var(--accent-muted); border-radius: 6px; padding: 1px 8px; text-decoration: none; }
a.ticket-id:hover { text-decoration: underline; }
.ticket-title { color: var(--text); }
.overview-stack { display: flex; flex-direction: column; gap: 14px; margin-bottom: 14px; }

/* ── findings ───────────────────────────────────────────────────────── */
.section-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 22px 0 10px; }
.section-head h2 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; }
.filters { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
.chip-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 11px; border-radius: 999px;
  border: 1px solid var(--border-strong); background: var(--surface);
  font-size: 12.5px; font-weight: 550; color: var(--text2); cursor: pointer;
  transition: all 150ms ease;
}
.chip-toggle .swatch { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.chip-toggle .n { color: var(--text3); font-weight: 650; }
.chip-toggle:hover:not(:disabled) { border-color: var(--accent); }
.chip-toggle[aria-pressed="true"] { background: var(--accent-subtle); border-color: var(--accent); color: var(--text); }
.chip-toggle:disabled { opacity: .45; cursor: default; }
.chip-toggle.sw-blocker .swatch { background: var(--danger); }
.chip-toggle.sw-major .swatch { background: var(--orange); }
.chip-toggle.sw-minor .swatch { background: var(--warning); }
.chip-toggle.sw-nit .swatch { background: var(--text3); }
.group-head { display: flex; align-items: center; gap: 8px; margin: 16px 0 8px; font-size: 13px; font-weight: 650; color: var(--text2); }
.group-head .line { flex: 1; height: 1px; background: var(--border); }
.finding {
  background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--border-strong);
  border-radius: 12px; padding: 14px 16px; margin-bottom: 10px; box-shadow: var(--shadow-sm);
}
.finding.sev-l-blocker { border-left-color: var(--danger); }
.finding.sev-l-major { border-left-color: var(--orange); }
.finding.sev-l-minor { border-left-color: var(--warning); }
.finding.sev-l-nit { border-left-color: var(--text3); }
.finding.sev-l-praise { border-left-color: var(--success); }
.fhead { display: flex; align-items: flex-start; gap: 10px; }
.ftitle { flex: 1; min-width: 0; font-weight: 650; font-size: 14.5px; line-height: 1.4; overflow-wrap: anywhere; }
.floc {
  display: inline-flex; align-items: center; gap: 5px; margin-top: 6px;
  font-family: var(--mono); font-size: 12px; color: var(--text2);
  background: var(--surface2); border: 1px solid var(--border); border-radius: 6px; padding: 1px 8px;
  max-width: 100%; overflow-wrap: anywhere;
}
.floc svg.ic { width: 12px; height: 12px; color: var(--text3); }
.fdetail { margin-top: 10px; }
.fsugg { margin-top: 10px; }
.fsugg-label { font-size: 11.5px; font-weight: 650; color: var(--text3); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; display: flex; align-items: center; gap: 5px; }
.fsugg pre.code { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.ffoot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
.rchip { font-size: 11.5px; font-weight: 550; color: var(--text2); background: var(--surface2); border: 1px solid var(--border); border-radius: 999px; padding: 0 8px; height: 20px; display: inline-flex; align-items: center; }
.consensus { font-size: 11.5px; font-weight: 650; color: var(--accent); background: var(--accent-subtle); border: 1px solid var(--accent-muted); border-radius: 999px; padding: 0 8px; height: 20px; display: inline-flex; align-items: center; gap: 4px; }
.consensus svg.ic { width: 12px; height: 12px; }
.conf { display: inline-flex; align-items: center; gap: 6px; flex: none; font-size: 11.5px; color: var(--text3); font-weight: 600; }
.conf-bar { width: 54px; height: 5px; border-radius: 3px; background: var(--surface3); overflow: hidden; }
.conf-bar i { display: block; height: 100%; border-radius: 3px; }
.conf-high .conf-bar i { background: var(--success); }
.conf-medium .conf-bar i { background: var(--warning); }
.conf-low .conf-bar i { background: var(--text3); }
.none-note { display: flex; align-items: center; gap: 8px; color: var(--text2); background: var(--surface); border: 1px dashed var(--border-strong); border-radius: 12px; padding: 14px 16px; font-size: 13.5px; }
.none-note.ok { color: var(--success); border-color: var(--success-border); background: var(--success-bg); border-style: solid; }
.dropped-list { list-style: none; margin: 0; padding: 0; }
.dropped-list li { padding: 7px 0; border-bottom: 1px dashed var(--border); font-size: 13px; }
.dropped-list li:last-child { border-bottom: 0; }
.dropped-list .dr-title { font-weight: 600; color: var(--text2); }
.dropped-list .dr-reason { color: var(--text3); }
.waiting-card { display: flex; align-items: center; gap: 14px; color: var(--text2); }
.waiting-title { font-weight: 600; color: var(--text); }
.dots { display: inline-flex; gap: 5px; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); animation: bounce 1.2s ease-in-out infinite; }
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
@keyframes bounce { 0%, 100% { transform: translateY(0); opacity: .45; } 50% { transform: translateY(-4px); opacity: 1; } }

/* ── triage ───────────────────────────────────────────────────────────────── */
.ffoot .factions { margin-left: auto; display: flex; gap: 6px; flex-wrap: wrap; }
.btn-quiet { border-color: var(--border); background: transparent; color: var(--text2); }
.btn-quiet:hover:not(:disabled) { color: var(--text); background: var(--surface-hover); }
.btn-quiet svg.ic { width: 14px; height: 14px; }
.finding.is-ignored { opacity: .62; box-shadow: none; background: var(--surface2); border-left-color: var(--border-strong); transition: opacity 150ms ease; }
.finding.is-ignored .ftitle { text-decoration: line-through; text-decoration-color: var(--text3); }
.finding.is-ignored:hover, .finding.is-ignored:focus-within { opacity: 1; }
.edited-tag {
  display: inline-flex; align-items: center; gap: 4px; flex: none;
  height: 20px; padding: 0 7px; border-radius: 999px;
  font-size: 11.5px; font-weight: 650;
  color: var(--accent); background: var(--accent-subtle); border: 1px solid var(--accent-muted);
}
.edited-tag svg.ic { width: 11px; height: 11px; }
.fcomment { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: var(--accent-subtle); border: 1px solid var(--accent-muted); }
.finding.is-edited .fdetail, .finding.is-edited .fsugg { opacity: .65; }
.fedit { margin-top: 10px; }
.fedit .textarea { min-height: 110px; font-size: 13.5px; }
.fedit-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.fedit-bar .field-hint { margin: 0; }
.fedit-bar .spacer { flex: 1; }
.ignored-list .field-hint { margin: 0 0 10px; }
.ignored-list .finding:last-child { margin-bottom: 0; }

/* ── publish ──────────────────────────────────────────────────────────────── */
.publish-card { margin-top: 14px; border-color: var(--accent-muted); box-shadow: var(--shadow); position: relative; overflow: hidden; }
.publish-card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--accent); }
.publish-head { display: flex; gap: 12px; align-items: flex-start; margin-bottom: 16px; }
.publish-icon { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; flex: none; color: var(--accent); background: var(--accent-subtle); }
.publish-icon svg.ic { width: 18px; height: 18px; }
.publish-head-text { flex: 1; min-width: 0; }
.publish-head h2 { margin: 0; font-size: 16px; line-height: 1.3; }
.publish-head p { margin: 3px 0 0; color: var(--text2); font-size: 13.5px; }
.publish-head p b { color: var(--text); font-weight: 600; }
.decision-group { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 16px; }
@media (max-width: 640px) { .decision-group { grid-template-columns: 1fr; } }
.decision-group.rerun-mode-group { grid-template-columns: 1fr; margin-bottom: 0; }
.decision-opt {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 10px 12px; border: 1px solid var(--border-strong); border-radius: 10px;
  background: var(--surface); cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}
.decision-opt:hover { border-color: var(--accent); }
.decision-opt input { margin: 3px 0 0; width: 15px; height: 15px; flex: none; accent-color: var(--accent); cursor: inherit; }
.decision-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.decision-label { display: flex; align-items: center; gap: 6px; font-weight: 650; font-size: 13.5px; }
.decision-label svg.ic { width: 14px; height: 14px; }
.decision-hint { font-size: 12px; color: var(--text3); line-height: 1.35; }
.decision-approve .decision-label svg.ic { color: var(--success); }
.decision-request_changes .decision-label svg.ic { color: var(--danger); }
.decision-comment .decision-label svg.ic { color: var(--accent); }
.decision-opt:has(input:checked) { border-color: var(--accent); background: var(--accent-subtle); box-shadow: inset 0 0 0 1px var(--accent); }
.decision-approve input { accent-color: var(--success); }
.decision-approve:has(input:checked) { border-color: var(--success); background: var(--success-bg); box-shadow: inset 0 0 0 1px var(--success); }
.decision-request_changes input { accent-color: var(--danger); }
.decision-request_changes:has(input:checked) { border-color: var(--danger); background: var(--danger-bg); box-shadow: inset 0 0 0 1px var(--danger); }
.decision-opt:has(input:focus-visible) { outline: 2px solid var(--ring); outline-offset: 2px; }
.decision-opt:has(input:disabled) { opacity: .55; cursor: default; }
.decision-opt:has(input:disabled):hover { border-color: var(--border-strong); }
.publish-label-row { display: flex; align-items: baseline; gap: 10px; }
.publish-label-row .field-label { flex: 1; }
.publish-label-row .link-btn { font-size: 12.5px; }
.publish-label-row .link-btn svg.ic { width: 13px; height: 13px; }
.publish-body { min-height: 130px; font-size: 13.5px; }
.textarea:disabled { opacity: .6; }
.publish-preview {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  font-size: 13px; color: var(--text2);
  background: var(--surface2); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; margin-bottom: 16px;
}
.publish-preview > details.fold { border: 0; margin: 0; padding: 0; width: 100%; }
.publish-preview > svg.ic { color: var(--text3); }
.preview-caption { font-weight: 600; color: var(--text); }
.preview-err { color: var(--danger); display: inline-flex; gap: 6px; align-items: center; }
.preview-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow: auto; }
.preview-item { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 8px 10px; }
.preview-where { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text3); margin-bottom: 4px; }
.preview-where svg.ic { width: 12px; height: 12px; }
.preview-where .mono { color: var(--text2); overflow-wrap: anywhere; }
.preview-text { font-size: 13px; }
.publish-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.spin { display: inline-flex; }
.spin svg.ic { animation: spin 1s linear infinite; }
.preview-updating svg.ic { width: 13px; height: 13px; color: var(--text3); }
.publish-status {
  display: flex; gap: 12px; align-items: flex-start;
  border: 1px solid var(--border); background: var(--surface2);
  border-radius: 10px; padding: 12px 14px; margin-bottom: 16px;
}
.ps-icon { display: inline-flex; flex: none; margin-top: 1px; }
.ps-icon svg.ic { width: 20px; height: 20px; }
.ps-main { flex: 1; min-width: 0; }
.ps-title { font-weight: 650; font-size: 14px; }
.ps-sub { font-size: 12.5px; color: var(--text3); margin-top: 1px; }
.ps-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.ps-error { margin: 4px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--mono); font-size: 12px; color: var(--text2); }
.ps-running { border-color: var(--accent-muted); background: var(--accent-subtle); }
.ps-running .ps-icon { color: var(--accent); }
.ps-posted { border-color: var(--success-border); background: var(--success-bg); }
.ps-posted .ps-icon, .ps-posted .ps-title { color: var(--success); }
.ps-failed { border-color: var(--danger-border); background: var(--danger-bg); }
.ps-failed .ps-icon, .ps-failed .ps-title { color: var(--danger); }
@media (max-width: 640px) { .publish-status { flex-wrap: wrap; } .ps-actions { width: 100%; } }

/* ── modal + forms ──────────────────────────────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 50;
  background: var(--backdrop);
  display: flex; align-items: flex-start; justify-content: center;
  padding: 6vh 16px 24px; overflow-y: auto;
  animation: fade 140ms ease-out;
}
.modal {
  width: 100%; max-width: 560px;
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 14px; box-shadow: var(--shadow-overlay);
  animation: rise 180ms cubic-bezier(.2,.8,.25,1);
}
.modal.sm { max-width: 420px; }
.modal-head { display: flex; align-items: center; gap: 10px; padding: 16px 20px 0; }
.modal-head h2 { font-size: 16px; margin: 0; flex: 1; }
.modal-body { padding: 14px 20px 4px; }
.modal-body p { margin: 0 0 10px; color: var(--text2); }
.modal-foot { display: flex; align-items: center; gap: 8px; padding: 14px 20px 18px; flex-wrap: wrap; }
.modal-foot .spacer { flex: 1; }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
.form-grid .full { grid-column: 1 / -1; }
@media (max-width: 520px) { .form-grid { grid-template-columns: 1fr; } }
.field { margin-bottom: 14px; min-width: 0; }
.field-label { display: flex; align-items: baseline; gap: 6px; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
.field-label .req { color: var(--danger); }
.field-label .opt { font-weight: 400; color: var(--text3); font-size: 12px; }
.input, .select, .textarea {
  width: 100%; height: 36px; padding: 0 11px;
  border: 1px solid var(--border-strong); border-radius: 8px;
  background: var(--surface); color: var(--text);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
.input.mono { font-family: var(--mono); font-size: 13px; }
.textarea { height: auto; min-height: 90px; padding: 9px 11px; resize: vertical; line-height: 1.5; }
.input::placeholder, .textarea::placeholder { color: var(--text3); }
.input:focus, .select:focus, .textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
.field.has-error .input, .field.has-error .select, .field.has-error .textarea { border-color: var(--danger); }
.field.has-error .input:focus { box-shadow: 0 0 0 3px var(--danger-bg); }
.input:disabled, .select:disabled { opacity: .6; }
.field-hint { font-size: 12px; color: var(--text3); margin-top: 5px; }
.field-error { font-size: 12px; color: var(--danger); margin-top: 5px; display: flex; gap: 5px; align-items: center; }
.field-error svg.ic { width: 13px; height: 13px; }
.form-error { border: 1px solid var(--danger-border); background: var(--danger-bg); color: var(--danger); border-radius: 8px; padding: 9px 12px; font-size: 13px; margin-bottom: 12px; }
.form-actions-reason { font-size: 12.5px; color: var(--text3); }

.combo { position: relative; }
.combo .input { padding-right: 34px; }
.combo-toggle { position: absolute; right: 3px; top: 3px; width: 30px; height: 30px; border: 0; background: none; color: var(--text3); cursor: pointer; display: grid; place-items: center; border-radius: 6px; }
.combo-toggle:hover { color: var(--text); }
.combo-list {
  position: absolute; z-index: 60; left: 0; right: 0; top: calc(100% + 4px);
  max-height: 240px; overflow-y: auto; margin: 0; padding: 4px; list-style: none;
  background: var(--surface); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--shadow-overlay);
}
.combo-option { padding: 6px 10px; border-radius: 6px; cursor: pointer; display: flex; flex-direction: column; gap: 1px; }
.combo-option .co-name { font-size: 13px; font-weight: 600; display: flex; align-items: center; gap: 6px; }
.combo-option .co-path { font-family: var(--mono); font-size: 11.5px; color: var(--text3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.combo-option.active { background: var(--surface-hover); }
.combo-option[aria-selected="true"] .co-name { color: var(--accent); }
.combo-empty { padding: 10px; font-size: 13px; color: var(--text3); }
.combo-selected-path { font-family: var(--mono); font-size: 11.5px; color: var(--text3); margin-top: 4px; overflow-wrap: anywhere; }

/* ── prompt editor ──────────────────────────────────────────────────── */
.prompt-editor {
  width: 100%; min-height: 52vh; padding: 14px 16px;
  border: 1px solid var(--border-strong); border-radius: 12px;
  background: var(--surface); color: var(--text);
  font-family: var(--mono); font-size: 13px; line-height: 1.6; resize: vertical;
}
.prompt-editor:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-subtle); }
.prompt-bar { display: flex; align-items: center; gap: 10px; margin-top: 12px; flex-wrap: wrap; }
.prompt-bar .spacer { flex: 1; }
.dirty { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--warning); font-weight: 600; }
.dirty .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.saved { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--text3); }
.saved svg.ic { width: 13px; height: 13px; color: var(--success); }
.prompt-badge { font-size: 11.5px; font-weight: 650; border-radius: 999px; padding: 1px 9px; border: 1px solid var(--border); color: var(--text2); background: var(--surface2); }
.prompt-badge.custom { color: var(--accent); background: var(--accent-subtle); border-color: var(--accent-muted); }
.char-count { font-size: 12px; color: var(--text3); }

/* ── toast ──────────────────────────────────────────────────────────── */
.toast {
  position: fixed; left: 50%; bottom: 22px; transform: translateX(-50%); z-index: 80;
  display: flex; align-items: center; gap: 8px;
  background: var(--text); color: var(--bg);
  padding: 9px 14px; border-radius: 10px; box-shadow: var(--shadow-overlay);
  font-size: 13px; font-weight: 550; max-width: calc(100vw - 32px);
  animation: rise 160ms ease-out;
}
.toast.error { background: var(--danger); color: #fff; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition: none !important; }
}
`;
