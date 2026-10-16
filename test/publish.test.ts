import { beforeEach, describe, expect, it } from "vitest";
import { docStore, hostCalls, setHandlers } from "./fakeHost";
import { validResult } from "./fixtures";
import { dispatch } from "../src/lib";

const FOLDER = { id: "f1", name: "repo", path: "/home/u/repo" };
const API = "/api/plugin-ui/pr-review";
let seq = 0;

function install() {
  const store = docStore();
  const session = () => ({ session: { id: `s${++seq}` } });
  setHandlers({
    ...store.handlers,
    peckboard_list_folders: () => ({ folders: [FOLDER] }),
    peckboard_list_models: () => ({
      models: [{ id: "claude:opus", display_name: "Opus", provider: "claude", account_id: null, tier: 3 }],
    }),
    peckboard_create_session: session,
    peckboard_orchestrate_create_session: session,
    peckboard_dispatch_capture: () => ({ ok: true }),
    peckboard_orchestrate_send: () => ({ ok: true }),
    peckboard_list_sessions_brief: () => ({ sessions: [] }),
  });
}

function http(method: string, sub: string, body?: unknown, query = ""): { status: number; json: any } {
  const out = JSON.parse(
    dispatch("http.request.authed", {
      method,
      path: `${API}/${sub}`,
      query,
      body: body === undefined ? "" : JSON.stringify(body),
    }),
  );
  return { status: out.payload.status, json: JSON.parse(out.payload.body) };
}

function tool(name: string, args: unknown, sessionId: string): any {
  return JSON.parse(
    dispatch("mcp.tool.invoke", { tool: name, arguments: args, context: { sessionId, folderId: "f1" } }),
  ).payload;
}

/// A done review; returns it plus the index of each finding by title.
function doneReview(): { r: any; idx: (title: string) => number } {
  const r = http("POST", "start", { branch: "feat/x", folder_id: "f1" }).json.review;
  expect(tool("pr_review_submit", { result: validResult() }, r.session_id).ok).toBe(true);
  const full = http("GET", "review", undefined, `id=${r.id}`).json.review;
  return { r: full, idx: (t) => full.result.findings.findIndex((f: any) => f.title === t) };
}

beforeEach(install);

describe("triage", () => {
  it("ignores and rewords findings; the preview follows", () => {
    const { r, idx } = doneReview();
    let p = http("GET", "publish-preview", undefined, `id=${r.id}`).json;
    expect(p.comments).toHaveLength(2);
    expect(p.body_items).toHaveLength(1); // the praise has no location
    expect(p.body).toContain("Adds retry");
    const blocker = p.comments.find((c: any) => c.index === idx("Retry loop never ends"));
    expect(blocker.text.startsWith("issue (blocking): ")).toBe(true);

    expect(http("POST", "triage", { id: r.id, index: idx("Unused import"), ignored: true }).status).toBe(200);
    http("POST", "triage", { id: r.id, index: idx("Retry loop never ends"), comment: "Please cap retries." });
    p = http("GET", "publish-preview", undefined, `id=${r.id}`).json;
    expect(p.ignored).toBe(1);
    expect(p.comments.map((c: any) => c.text)).toEqual(["issue (blocking): Please cap retries."]);

    // Clearing the override restores the finding's own wording.
    http("POST", "triage", { id: r.id, index: idx("Retry loop never ends"), comment: null });
    p = http("GET", "publish-preview", undefined, `id=${r.id}`).json;
    expect(p.comments[0].text).toContain("Retry loop never ends");
  });

  it("refuses before the review is done and out-of-range indexes", () => {
    const r = http("POST", "start", { branch: "feat/y", folder_id: "f1" }).json.review;
    expect(http("POST", "triage", { id: r.id, index: 0, ignored: true }).json.error).toMatch(/not done/);
    const { r: done } = doneReview();
    expect(http("POST", "triage", { id: done.id, index: 9, ignored: true }).json.error).toMatch(/index/);
  });
});

describe("publish", () => {
  it("requires the user's decision and never infers it from the verdict", () => {
    const { r } = doneReview();
    const res = http("POST", "publish", { id: r.id });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/decision is required/);
  });

  it("posts the chosen decision with only non-ignored findings, then records the result", () => {
    const { r, idx } = doneReview();
    http("POST", "triage", { id: r.id, index: idx("Unused import"), ignored: true });
    // The model suggested request_changes; the user approves anyway.
    const out = http("POST", "publish", { id: r.id, decision: "approve", body: "LGTM overall." });
    expect(out.status).toBe(200);
    const pub = out.json.review.publish;
    expect(pub).toMatchObject({ decision: "approve", status: "running", body: "LGTM overall." });
    const kick = hostCalls.find((c) => c.name === "peckboard_dispatch_capture" && c.input.session_id === pub.session_id);
    expect(kick?.input.prompt).toContain('"event": "APPROVE"');
    expect(kick?.input.prompt).toContain("Retry loop never ends");
    expect(kick?.input.prompt).not.toContain("Unused import");
    expect(kick?.input.prompt).toContain('"start_line": 10'); // multi-line comment

    // Second publish while running is refused; triage is locked.
    expect(http("POST", "publish", { id: r.id, decision: "comment" }).json.error).toMatch(/already running/);
    expect(http("POST", "triage", { id: r.id, index: 0, ignored: true }).json.error).toMatch(/publish is running/);

    // Only the publish session may report; the review session may not.
    expect(tool("pr_review_publish_result", { ok: true }, r.session_id).error).toMatch(/reserved/);
    const done = tool(
      "pr_review_publish_result",
      { ok: true, pr_url: "https://github.com/o/r/pull/7", comments_posted: 1 },
      pub.session_id,
    );
    expect(done.status).toBe("posted");
    const after = http("GET", "review", undefined, `id=${r.id}`).json.review.publish;
    expect(after).toMatchObject({ status: "posted", pr_url: "https://github.com/o/r/pull/7", comments_posted: 1 });
    expect(after.nudges).toBeUndefined();
  });

  it("watchdog: one nudge, then failed; a failed publish can be retried", () => {
    const { r } = doneReview();
    const pub = http("POST", "publish", { id: r.id, decision: "request_changes" }).json.review.publish;
    const end = () => JSON.parse(dispatch("session.agent.ended", { session_id: pub.session_id, outcome: "completed" }));
    expect(end().payload.nudged).toBe(true);
    expect(end().payload.failed).toBe(true);
    const failed = http("GET", "review", undefined, `id=${r.id}`).json.review.publish;
    expect(failed.status).toBe("failed");
    expect(http("POST", "publish", { id: r.id, decision: "request_changes" }).json.review.publish.status).toBe(
      "running",
    );
  });

  it("session tools: triage + publish via MCP, requester hears the outcome", () => {
    const { r, idx } = doneReview();
    const t = tool("pr_review_triage", { id: r.id, index: idx("Unused import"), ignored: true }, "caller");
    expect(t.preview.ignored).toBe(1);
    expect(tool("pr_review_publish", { id: r.id }, "caller").error).toMatch(/decision is required/);
    const p = tool("pr_review_publish", { id: r.id, decision: "comment" }, "caller");
    expect(p.ok).toBe(true);
    const create = hostCalls.find((c) => c.name === "peckboard_orchestrate_create_session");
    expect(create?.input.name).toBe("Publish PR review: feat/x");
    tool("pr_review_publish_result", { ok: false, error: "no open PR for feat/x" }, p.publish.session_id);
    const msg = hostCalls.filter((c) => c.name === "peckboard_orchestrate_send" && c.input.session_id === "caller");
    expect(msg.at(-1)?.input.text).toContain("publishing FAILED: no open PR");
  });
});
