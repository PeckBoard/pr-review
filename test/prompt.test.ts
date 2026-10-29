import { describe, expect, it } from "vitest";
import {
  buildSystemPrompt,
  DEFAULT_GLOBAL_PROMPT,
  kickoffMessage,
  REVIEWER_PROMPT,
} from "../src/prompt";
import { Review } from "../src/types";

function review(over: Partial<Review> = {}): Review {
  return {
    id: "r1",
    branch: "feat/ABC-1",
    base: null,
    folder_id: "f1",
    folder_name: "repo",
    folder_path: "/home/u/repo",
    model: "claude:x",
    custom_prompt: "",
    session_id: null,
    status: "queued",
    step: "starting",
    log: [],
    providers: {},
    counts: { blocker: 0, major: 0, minor: 0, nit: 0, praise: 0 },
    created_at: "",
    updated_at: "",
    finished_at: null,
    error: null,
    result: null,
    ...over,
  };
}

describe("prompt assembly", () => {
  it("default global prompt carries the orchestration and the reviewer prompt", () => {
    expect(DEFAULT_GLOBAL_PROMPT).toContain("spawn_subagent");
    expect(DEFAULT_GLOBAL_PROMPT).toContain(REVIEWER_PROMPT);
  });

  it("appends custom instructions, then the fixed contract", () => {
    const p = buildSystemPrompt(review({ custom_prompt: "Check SQL." }), DEFAULT_GLOBAL_PROMPT);
    const custom = p.indexOf("## Additional instructions for this review\nCheck SQL.");
    const contract = p.indexOf("## Review contract");
    expect(custom).toBeGreaterThan(0);
    expect(contract).toBeGreaterThan(custom);
    expect(p).toContain("NEVER `git checkout`");
    expect(p).toContain("git worktree add --detach pr-review-worktrees/r1");
    expect(p).toContain("git worktree remove --force");
    expect(p).toContain("pr_review_step");
    expect(p).toContain("pr_review_submit");
    expect(p).toContain("`feat/ABC-1`");
    expect(p).toContain("/home/u/repo");
  });

  it("omits the custom section when empty and keeps the contract under an override", () => {
    const p = buildSystemPrompt(review(), "Custom global.");
    expect(p).not.toContain("Additional instructions");
    expect(p.startsWith("Custom global.")).toBe(true);
    expect(p).toContain("## Review contract");
  });

  it("kickoff names branch, base (or auto-detect) and review id", () => {
    expect(kickoffMessage(review())).toContain("auto-detect: origin/HEAD, main, master");
    const k = kickoffMessage(review({ base: "develop" }));
    expect(k).toContain("feat/ABC-1");
    expect(k).toContain("develop");
    expect(k).toContain("r1");
  });

  it("contract sends a small change to a single opus reviewer, even under a custom global prompt", () => {
    const p = buildSystemPrompt(review(), "Custom global.");
    expect(p).toContain("### Number of reviewers");
    expect(p).toContain("claude-opus-5-5");
    expect(p).toContain("git diff --shortstat");
  });

  it("kickoff has no duplicated lines and names the scope", () => {
    const k = kickoffMessage(review());
    expect(k.split("Review branch").length).toBe(2);
    expect(k).toContain("Fetch first");
  });
});
