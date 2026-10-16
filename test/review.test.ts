import { beforeEach, describe, expect, it } from "vitest";
import { docStore, hostCalls, setHandlers } from "./fakeHost";
import { validResult } from "./fixtures";
import { dispatch } from "../src/lib";
import { MAX_NUDGES } from "../src/review";

const FOLDER = { id: "f1", name: "repo", path: "/home/u/repo" };
const API = "/api/plugin-ui/pr-review";

let store: ReturnType<typeof docStore>;
let liveSessions: Set<string>;
let sessionSeq = 0;

function install() {
  store = docStore();
  liveSessions = new Set();
  setHandlers({
    ...store.handlers,
    peckboard_list_folders: () => ({ folders: [FOLDER] }),
    peckboard_list_models: () => ({
      models: [
        { id: "claude:claude-sonnet-5", display_name: "Sonnet", provider: "claude", account_id: null, tier: 2 },
        { id: "claude:claude-opus-5-5", display_name: "Opus", provider: "claude", account_id: null, tier: 3 },
        { id: "codex:gpt-6", display_name: "GPT", provider: "codex", account_id: null, tier: 3 },
      ],
    }),
    peckboard_create_session: () => {
      const id = `s${++sessionSeq}`;
      liveSessions.add(id);
      return { session: { id } };
    },
    peckboard_dispatch_capture: () => ({ ok: true }),
    peckboard_orchestrate_send: () => ({ ok: true }),
    peckboard_orchestrate_terminate: () => ({ ok: true }),
    peckboard_list_sessions_brief: () => ({
      sessions: [...liveSessions].map((id) => ({ session_id: id })),
    }),
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
  const out = JSON.parse(
    dispatch("mcp.tool.invoke", { tool: name, arguments: args, context: { sessionId, folderId: "f1" } }),
  );
  return out.payload;
}

function ended(sessionId: string, outcome = "completed") {
  return JSON.parse(dispatch("session.agent.ended", { session_id: sessionId, outcome })).payload;
}

function review(id: string): any {
  return http("GET", "review", undefined, `id=${encodeURIComponent(id)}`).json.review;
}

function start(): any {
  const res = http("POST", "start", { branch: "feat/ABC-12-retry", folder_id: "f1", prompt: "Focus on retries." });
  expect(res.status).toBe(200);
  return res.json.review;
}

beforeEach(install);

describe("start", () => {
  it("creates a named non-temp session in the chosen folder and dispatches the kickoff", () => {
    const r = start();
    expect(r.status).toBe("running");
    expect(r.step).toBe("starting");
    expect(r.model).toBe("claude:claude-opus-5-5"); // top claude, opus preferred
    expect(r.providers).toEqual({ claude: "pending", codex: "pending", grok: "pending" });
    expect(r.nudges).toBeUndefined();

    const create = hostCalls.find((c) => c.name === "peckboard_create_session")!.input;
    expect(create).toMatchObject({
      name: "PR review: feat/ABC-12-retry",
      is_temp: false,
      folder_path: "/home/u/repo",
      model: "claude:claude-opus-5-5",
    });
    expect(create.system_prompt).toContain("Focus on retries.");
    const kick = hostCalls.find((c) => c.name === "peckboard_dispatch_capture")!.input;
    expect(kick.session_id).toBe(r.session_id);
    expect(kick.prompt).toContain("feat/ABC-12-retry");
    expect(kick.prompt).toContain(r.id);
  });

  it("rejects an empty branch, a shell-ish branch and an unknown folder with 400", () => {
    expect(http("POST", "start", { branch: "", folder_id: "f1" }).status).toBe(400);
    expect(http("POST", "start", { branch: "x; rm -rf /", folder_id: "f1" }).json.error).toMatch(
      /not a valid branch/,
    );
    expect(http("POST", "start", { branch: "main", folder_id: "nope" }).json.error).toBe(
      "folder not found",
    );
  });

  it("lists reviews newest first without log/result, plus folders, models and settings", () => {
    const a = start();
    const b = start();
    const s = http("GET", "state").json;
    expect(s.reviews.map((r: any) => r.id).sort()).toEqual([a.id, b.id].sort());
    expect(s.reviews[0].log).toBeUndefined();
    expect(s.reviews[0].result).toBeUndefined();
    expect(s.folders).toEqual([FOLDER]);
    expect(s.models[0]).toEqual({ id: "claude:claude-sonnet-5", display_name: "Sonnet", provider: "claude" });
    expect(s.settings.default_model).toBe("claude:claude-opus-5-5");
    expect(s.settings.global_prompt).toBe(s.settings.default_global_prompt);
  });
});

describe("tools", () => {
  it("step → submit marks the review done with counts", () => {
    const r = start();
    expect(tool("pr_review_step", { step: "context", note: "diffing" }, r.session_id).ok).toBe(true);
    tool("pr_review_step", { step: "reviewing", provider: "grok", provider_status: "failed" }, r.session_id);
    const bad = tool("pr_review_submit", { result: { summary: "x" } }, r.session_id);
    expect(bad.error).toMatch(/result rejected/);
    expect(review(r.id).status).toBe("running");

    const ok = tool("pr_review_submit", { result: validResult() }, r.session_id);
    expect(ok.ok).toBe(true);
    const done = review(r.id);
    expect(done.status).toBe("done");
    expect(done.step).toBe("done");
    expect(done.finished_at).toBeTruthy();
    expect(done.counts).toEqual({ blocker: 1, major: 0, minor: 1, nit: 0, praise: 1 });
    expect(done.providers).toEqual({ claude: "done", codex: "done", grok: "failed" });
    expect(done.result.verdict).toBe("request_changes");
    expect(done.log.map((l: any) => l.step)).toContain("context");

    // A finished review refuses further tool calls.
    expect(tool("pr_review_step", { step: "merging" }, r.session_id).error).toMatch(/is done/);
  });

  it("maps a tool call to its review by the calling session only", () => {
    const a = start();
    const b = start();
    tool("pr_review_step", { step: "merging" }, b.session_id);
    expect(review(a.id).step).toBe("starting");
    expect(review(b.id).step).toBe("merging");
    expect(tool("pr_review_step", { step: "context" }, "stranger").error).toMatch(/reserved/);
  });

  it("abort_reason fails the review with that error", () => {
    const r = start();
    tool("pr_review_step", { step: "context", abort_reason: "branch does not exist" }, r.session_id);
    const f = review(r.id);
    expect(f.status).toBe("failed");
    expect(f.error).toBe("branch does not exist");
  });
});

describe("watchdog", () => {
  it("nudges a run that ended without submitting, then fails explicitly", () => {
    const r = start();
    for (let i = 1; i <= MAX_NUDGES; i++) {
      expect(ended(r.session_id).nudged).toBe(true);
    }
    const sends = hostCalls.filter((c) => c.name === "peckboard_orchestrate_send");
    expect(sends).toHaveLength(MAX_NUDGES);
    expect(sends[0].input.session_id).toBe(r.session_id);
    expect(sends[0].input.text).toContain("pr_review_submit");

    expect(ended(r.session_id).failed).toBe(true);
    const f = review(r.id);
    expect(f.status).toBe("failed");
    expect(f.error).toMatch(/without submitting a result/);
  });

  it("progress resets the count; waiting on running reviewers is not nudged", () => {
    const r = start();
    ended(r.session_id);
    tool("pr_review_step", { step: "reviewing", provider: "claude", provider_status: "running" }, r.session_id);
    hostCalls.length = 0;
    expect(ended(r.session_id).waiting).toBe(true);
    expect(hostCalls.some((c) => c.name === "peckboard_orchestrate_send")).toBe(false);
    tool("pr_review_step", { step: "merging", provider: "claude", provider_status: "done" }, r.session_id);
    ended(r.session_id);
    ended(r.session_id);
    expect(review(r.id).status).toBe("running"); // counter was reset by progress
  });

  it("ignores sessions that are not review sessions and finished reviews", () => {
    expect(ended("other")).toEqual({ ok: true });
    const r = start();
    tool("pr_review_submit", { result: validResult() }, r.session_id);
    hostCalls.length = 0;
    ended(r.session_id);
    expect(hostCalls.some((c) => c.name === "peckboard_orchestrate_send")).toBe(false);
  });
});

describe("cancel / delete / rerun / settings", () => {
  it("cancel stops the agent and later ends are ignored", () => {
    const r = start();
    expect(http("POST", "cancel", { id: r.id }).json).toEqual({ ok: true });
    expect(hostCalls.find((c) => c.name === "peckboard_orchestrate_terminate")!.input.session_id).toBe(
      r.session_id,
    );
    expect(review(r.id).status).toBe("cancelled");
    hostCalls.length = 0;
    ended(r.session_id);
    expect(hostCalls.some((c) => c.name === "peckboard_orchestrate_send")).toBe(false);
    expect(tool("pr_review_step", { step: "context" }, r.session_id).error).toMatch(/cancelled/);
  });

  it("rerun starts a new review with the same inputs; delete removes it", () => {
    const r = start();
    const again = http("POST", "rerun", { id: r.id }).json.review;
    expect(again.id).not.toBe(r.id);
    expect(again.session_id).not.toBe(r.session_id);
    expect(again).toMatchObject({ branch: r.branch, folder_id: "f1", custom_prompt: "Focus on retries." });

    expect(http("POST", "delete", { id: r.id }).json).toEqual({ ok: true });
    expect(http("GET", "review", undefined, `id=${r.id}`).status).toBe(400);
    expect(store.docs[`session_index/${r.session_id}`]).toBeUndefined();
  });

  it("marks a running review failed when its session was deleted", () => {
    const r = start();
    liveSessions.delete(r.session_id);
    const s = http("GET", "state").json;
    expect(s.reviews.find((x: any) => x.id === r.id).status).toBe("failed");
  });

  it("settings override the global prompt; empty resets to default", () => {
    const set = http("POST", "settings", { global_prompt: "Be terse." }).json.settings;
    expect(set.global_prompt).toBe("Be terse.");
    start();
    const create = hostCalls.find((c) => c.name === "peckboard_create_session")!.input;
    expect(create.system_prompt.startsWith("Be terse.")).toBe(true);
    expect(create.system_prompt).toContain("Review contract");

    const reset = http("POST", "settings", { global_prompt: "" }).json.settings;
    expect(reset.global_prompt).toBe(reset.default_global_prompt);
  });
});
