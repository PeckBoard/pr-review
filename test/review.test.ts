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
    peckboard_orchestrate_create_session: () => {
      const id = `s${++sessionSeq}`;
      liveSessions.add(id);
      return { session: { id } };
    },
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

  it("rerun mode: latest fetches again, current pins the recorded commit", () => {
    const sha = "a".repeat(40);
    const r = start();
    // No commit recorded yet: same-commit is refused, latest still works.
    expect(http("POST", "rerun", { id: r.id, mode: "current" }).json.error).toMatch(/did not record/);
    expect(http("POST", "rerun", { id: r.id, mode: "bogus" }).json.error).toMatch(/mode must be/);
    expect(tool("pr_review_step", { step: "context", commit: "abc" }, r.session_id).error).toMatch(/full 40/);
    tool("pr_review_step", { step: "context", commit: sha.toUpperCase() }, r.session_id);
    expect(review(r.id)).toMatchObject({ commit: sha, pinned: false });

    const latest = http("POST", "rerun", { id: r.id, mode: "latest" }).json.review;
    expect(latest).toMatchObject({ commit: null, pinned: false });

    hostCalls.length = 0;
    const same = http("POST", "rerun", { id: r.id, mode: "current" }).json.review;
    expect(same).toMatchObject({ commit: sha, pinned: true });
    const create = hostCalls.find((c) => c.name === "peckboard_create_session")!.input;
    expect(create.system_prompt).toContain(`git worktree add --detach pr-review-worktrees/${same.id} ${sha}`);
    expect(hostCalls.find((c) => c.name === "peckboard_dispatch_capture")!.input.prompt).toContain(sha);
    // A pinned review refuses a different commit.
    expect(tool("pr_review_step", { step: "context", commit: "b".repeat(40) }, same.session_id).error).toMatch(
      /pinned/,
    );

    // The MCP tool takes the same mode.
    const viaTool = tool("pr_review_rerun", { id: r.id, mode: "current" }, "caller");
    expect(viaTool.review).toMatchObject({ commit: sha, pinned: true });
  });

  it("latest rerun is incremental: only commits since the last successful review, findings + triage carried", () => {
    const sha = "c".repeat(40);
    const r = start();
    // A rerun before any success has nothing to build on.
    expect(http("POST", "rerun", { id: r.id }).json.review.baseline).toBeNull();
    tool("pr_review_step", { step: "context", commit: sha }, r.session_id);
    tool("pr_review_submit", { result: validResult() }, r.session_id);
    expect(http("POST", "triage", { id: r.id, index: 0, ignored: true }).status).toBe(200);

    hostCalls.length = 0;
    const inc = http("POST", "rerun", { id: r.id }).json.review;
    expect(inc.baseline).toEqual({ review_id: r.id, commit: sha });
    const prompt = hostCalls.find((c) => c.name === "peckboard_create_session")!.input.system_prompt;
    expect(prompt).toContain("## Incremental re-run");
    expect(prompt).toContain(`git diff ${sha}..HEAD`);
    expect(prompt).toContain("Retry loop never ends"); // earlier findings ride along
    expect(hostCalls.find((c) => c.name === "peckboard_dispatch_capture")!.input.prompt).toContain(
      `ONLY the commits after ${sha}`,
    );

    // Nothing new pushed: `unchanged` re-uses the earlier result, no reviewer ran.
    expect(tool("pr_review_submit", { unchanged: true }, inc.session_id).error).toMatch(/HEAD to be the earlier commit/);
    tool("pr_review_step", { step: "context", commit: sha }, inc.session_id);
    expect(tool("pr_review_submit", { unchanged: true }, inc.session_id).ok).toBe(true);
    const done = review(inc.id);
    expect(done.result.findings).toEqual(review(r.id).result.findings);
    expect(done.result.dropped).toEqual([]);
    expect(done.providers).toEqual({});
    expect(done.triage).toEqual({ "0": { ignored: true, comment: null } });

    // A failed later review still re-runs from the newest success.
    const failed = http("POST", "rerun", { id: inc.id }).json.review;
    http("POST", "cancel", { id: failed.id });
    expect(http("POST", "rerun", { id: failed.id }).json.review.baseline.review_id).toBe(inc.id);

    // full ignores the baseline.
    hostCalls.length = 0;
    expect(http("POST", "rerun", { id: r.id, mode: "full" }).json.review.baseline).toBeNull();
    expect(hostCalls.find((c) => c.name === "peckboard_create_session")!.input.system_prompt).not.toContain(
      "Incremental re-run",
    );
  });

  it("carried findings are copied by index; the reviewer brief scopes reviewers to new commits", () => {
    const sha = "d".repeat(40);
    const r = start();
    tool("pr_review_step", { step: "context", commit: sha }, r.session_id);
    tool("pr_review_submit", { result: validResult() }, r.session_id);
    const before = review(r.id).result.findings; // [blocker, minor, praise]
    const inc = http("POST", "rerun", { id: r.id }).json.review;

    const brief = tool("pr_review_reviewer_brief", { review_id: inc.id }, "some-subagent").brief;
    expect(brief).toContain(`only the commits after \`${sha}\``);
    expect(brief).toContain("0. [blocker] src/up.ts:10-12 — Retry loop never ends");
    expect(brief).toContain("/home/u/repo/pr-review-worktrees/" + inc.id + ".context/diff.patch");
    expect(brief).toContain("Focus on retries.");
    expect(brief).toContain("Reviewer JSON schema");
    expect(tool("pr_review_reviewer_brief", { review_id: "nope" }, "x").error).toMatch(/not found/);

    const fresh = { ...validResult().findings[1], title: "New off-by-one", line: 7 };
    const base = { ...validResult(), findings: [fresh], dropped: [{ title: "Unused import", reason: "fixed in new commits" }] };
    expect(tool("pr_review_submit", { result: { ...base, carried: [9] } }, inc.session_id).error).toMatch(/carried/);
    expect(tool("pr_review_submit", { result: { ...base, carried: [0, 2] } }, inc.session_id).ok).toBe(true);
    const titles = review(inc.id).result.findings.map((f: any) => f.title);
    expect(titles).toEqual([before[0].title, "New off-by-one", before[2].title]);
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

describe("session tools", () => {
  it("pr_review_start creates the review in the caller's folder and notifies it on submit", () => {
    const res = tool("pr_review_start", { branch: "feat/x" }, "caller");
    expect(res.error).toBeUndefined();
    const r = res.review;
    expect(r.status).toBe("running");
    expect(r.folder_id).toBe("f1");
    expect(r.model).toBe("claude:claude-opus-5-5");
    expect(res.page).toContain(r.id);
    // Explicit-folder create + orchestrate kickoff, not the caller-pinned pair.
    const create = hostCalls.find((c) => c.name === "peckboard_orchestrate_create_session");
    expect(create?.input).toMatchObject({ folder_id: "f1", name: "PR review: feat/x" });
    expect(hostCalls.some((c) => c.name === "peckboard_create_session")).toBe(false);
    const kick = hostCalls.find((c) => c.name === "peckboard_orchestrate_send");
    expect(kick?.input.session_id).toBe(r.session_id);

    expect(tool("pr_review_submit", { result: validResult() }, r.session_id).ok).toBe(true);
    const note = hostCalls.filter(
      (c) => c.name === "peckboard_orchestrate_send" && c.input.session_id === "caller",
    );
    expect(note).toHaveLength(1);
    expect(note[0].input.text).toContain(`[PR review ${r.id}]`);
    expect(note[0].input.text).toContain("verdict:");

    const got = tool("pr_review_get", { id: r.id }, "caller");
    expect(got.review.status).toBe("done");
    expect(got.review.result.summary).toBeTruthy();
    expect(tool("pr_review_list", { status: "done" }, "caller").reviews.map((x: any) => x.id)).toContain(r.id);
  });

  it("notify:false stays silent; failures are reported to a notifying caller", () => {
    const quiet = tool("pr_review_start", { branch: "a", notify: false }, "caller").review;
    tool("pr_review_submit", { result: validResult() }, quiet.session_id);
    const loud = tool("pr_review_start", { branch: "b" }, "caller").review;
    for (let i = 0; i <= MAX_NUDGES; i++) ended(loud.session_id);
    const toCaller = hostCalls.filter(
      (c) => c.name === "peckboard_orchestrate_send" && c.input.session_id === "caller",
    );
    expect(toCaller).toHaveLength(1);
    expect(toCaller[0].input.text).toContain("FAILED");
  });

  it("rejects unknown folders/models and refuses calls from a review session", () => {
    expect(tool("pr_review_start", { branch: "x", folder_id: "nope" }, "caller").error).toMatch(/folder not found/);
    expect(tool("pr_review_start", { branch: "x", model: "mock:nope" }, "caller").error).toMatch(/unknown/);
    const r = tool("pr_review_start", { branch: "x", folder: "repo" }, "caller").review;
    expect(tool("pr_review_start", { branch: "y" }, r.session_id).error).toMatch(/cannot start/);
    expect(tool("pr_review_cancel", { id: r.id }, "caller").ok).toBe(true);
    expect(tool("pr_review_get", { id: r.id }, "caller").review.status).toBe("cancelled");
  });

  it("global prompt round-trips through get/set; empty restores the default", () => {
    expect(tool("pr_review_get_prompt", {}, "caller").is_default).toBe(true);
    expect(tool("pr_review_set_prompt", { global_prompt: "Be terse." }, "caller").is_default).toBe(false);
    expect(tool("pr_review_get_prompt", {}, "caller").global_prompt).toBe("Be terse.");
    expect(tool("pr_review_set_prompt", { global_prompt: "" }, "caller").is_default).toBe(true);
  });
});