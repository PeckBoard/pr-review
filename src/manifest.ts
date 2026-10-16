// The plugin manifest JSON body — identity, hooks, permissions, the two MCP
// tools the review session reports through, the PR Reviews page + its
// authenticated data routes.

// Single source of truth for the version: package.json (bundled by
// esbuild/vitest via resolveJsonModule) — a manifest that self-reports an old
// version makes the registry's "upgrade available" chip permanent.
import { version as VERSION } from "../package.json";
import { PAGE_PATH, UI_ROUTES } from "./http";
import { PROVIDER_STATUSES, SEVERITIES, STEPS, VERDICTS } from "./types";

const DESCRIPTION =
  "PR Review: review a git branch like a pull request. Pick a folder and a branch; a " +
  "dedicated agent session gathers the branch's context once (diff, commits, PR body, " +
  "ticket), fans the review out to independent claude, codex and grok reviewer subagents " +
  "in parallel, merges their findings, re-verifies every serious or single-reviewer " +
  "finding in the code, and submits one structured result: summary, why, verdict, and " +
  "ranked findings with file/line, suggested fix, which reviewers raised each, and " +
  "confidence. The review runs in a detached git worktree — your checkout is never " +
  "touched. The reviewer prompt is editable globally and per review.";

const REPOSITORY = "https://github.com/peckboard/pr-review";
// Inline SVG (lucide "git-pull-request") for the sidebar entry.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/>' +
  '<path d="M13 6h3a2 2 0 0 1 2 2v7"/><line x1="6" x2="6" y1="9" y2="21"/></svg>';

const FINDING_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["change", "praise"] },
    severity: {
      type: ["string", "null"],
      enum: [...SEVERITIES, null],
      description: "Required for kind 'change'; null for praise.",
    },
    file: { type: ["string", "null"], description: "Path from the repo root, or null." },
    line: {
      type: ["integer", "null"],
      minimum: 1,
      description: "NEW-file line number (right side of the diff), or null.",
    },
    end_line: { type: ["integer", "null"], minimum: 1, description: "Last line of a range, >= line." },
    title: { type: "string", description: "One line naming the problem (or the praised thing)." },
    detail: { type: "string", description: "What is wrong, the concrete trigger, the consequence." },
    suggestion: {
      type: ["string", "null"],
      description: "A specific fix; a snippet of at most 6 lines when it helps. Null if none.",
    },
    reviewers: {
      type: "array",
      items: { type: "string" },
      description: "Providers that raised it, e.g. [\"claude\", \"grok\"].",
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["kind", "severity", "title", "detail", "reviewers", "confidence"],
  additionalProperties: false,
};

export function manifestJson(): string {
  const manifest = {
    description: DESCRIPTION,
    version: VERSION,
    repository: REPOSITORY,

    hooks: ["mcp.tool.invoke", "http.request.before", "http.request.authed", "session.agent.ended"],

    permissions: [
      "provide_mcp_tools", // the review session reports back through our tools
      "data_store", // reviews, session→review index, settings
      "models_read", // model picker + default model
      "session_write", // create the review session in the chosen folder
      "session_read", // notice a review session deleted mid-run
      "session_dispatch", // kickoff prompt from the start/rerun request
      "session_orchestrate", // watchdog nudge from session.agent.ended + cancel from the global page
      "user_authority", // authenticated page routes; create_session folder_path
      "contribute_sidebar", // the PR Reviews sidebar entry
    ],

    // A GLOBAL page: reviews span folders, and each start names its folder
    // explicitly (create_session's folder_path under user authority).
    sidebar_items: [{ id: "pr-review", label: "PR Reviews", icon: ICON, path: PAGE_PATH }],

    http_routes: [`GET ${PAGE_PATH}`],

    ui_routes: UI_ROUTES,

    mcp_tools: [
      {
        name: "pr_review_step",
        description:
          "Report PR-review progress to the PR Reviews page. Call it at the start of every step " +
          "(context, reviewing, merging, verifying, submitting) and whenever a reviewer subagent " +
          "starts, finishes or fails (pass provider + provider_status). Only works from a PR " +
          "review session. Pass abort_reason ONLY when the review cannot be completed at all.",
        input_schema: {
          type: "object",
          properties: {
            step: {
              type: "string",
              enum: STEPS.filter((s) => s !== "done"),
              description: "The step you are in now.",
            },
            note: { type: "string", description: "One short line on what is happening." },
            provider: {
              type: "string",
              description: "Reviewer provider id this update is about: claude, codex or grok.",
            },
            provider_status: {
              type: "string",
              enum: PROVIDER_STATUSES,
              description: "That reviewer's status. Required with provider.",
            },
            abort_reason: {
              type: "string",
              description:
                "Marks the review FAILED with this reason (e.g. the branch does not exist). Never " +
                "use it for a single failed reviewer — list that in reviewers_failed instead.",
            },
          },
          required: ["step"],
          additionalProperties: false,
        },
      },
      {
        name: "pr_review_submit",
        description:
          "Submit the final merged PR review. Validated strictly: on any problem you get an error " +
          "listing every field to fix — fix them and call again. On success the review is done; " +
          "end your turn after removing the worktree.",
        input_schema: {
          type: "object",
          properties: {
            result: {
              type: "object",
              properties: {
                summary: { type: "string", description: "2-5 sentences: what the change does and how." },
                why: { type: "string", description: "The motivation, or 'unclear'." },
                ticket: {
                  type: ["object", "null"],
                  properties: {
                    id: { type: "string" },
                    url: { type: ["string", "null"] },
                    title: { type: ["string", "null"] },
                  },
                  required: ["id"],
                  additionalProperties: false,
                  description: "The ticket you actually found, or null. Never invent one.",
                },
                verdict: { type: "string", enum: VERDICTS },
                findings: {
                  type: "array",
                  items: FINDING_SCHEMA,
                  description:
                    "Sorted blocker > major > minor > nit (consensus first), then praise (max 5).",
                },
                reviewers_failed: {
                  type: "array",
                  items: { type: "string" },
                  description: "Providers that were missing or failed twice.",
                },
                dropped: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { title: { type: "string" }, reason: { type: "string" } },
                    required: ["title", "reason"],
                    additionalProperties: false,
                  },
                  description: "Reviewer findings you refuted in code, with the reason.",
                },
              },
              required: ["summary", "why", "ticket", "verdict", "findings", "reviewers_failed", "dropped"],
              additionalProperties: false,
            },
          },
          required: ["result"],
          additionalProperties: false,
        },
      },
    ],
  };
  return JSON.stringify(manifest);
}
