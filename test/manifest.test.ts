import { describe, expect, it } from "vitest";
import { manifestJson } from "../src/manifest";

const manifest = JSON.parse(manifestJson());

describe("manifest", () => {
  it("carries the required identity fields, version from package.json", async () => {
    const pkg = await import("../package.json");
    expect(manifest.description).toBeTruthy();
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.repository).toBe("https://github.com/peckboard/pr-review");
  });

  it("declares the hooks, page and exact UI route contract", () => {
    expect(manifest.hooks).toEqual(
      expect.arrayContaining([
        "mcp.tool.invoke",
        "http.request.before",
        "http.request.authed",
        "session.agent.ended",
      ]),
    );
    expect(manifest.sidebar_items).toEqual([
      expect.objectContaining({ label: "PR Reviews", path: "/plugin-api/v1/pr-review" }),
    ]);
    expect(manifest.http_routes).toEqual(["GET /plugin-api/v1/pr-review"]);
    expect([...manifest.ui_routes].sort()).toEqual(
      [
        "GET /api/plugin-ui/pr-review/state",
        "GET /api/plugin-ui/pr-review/review",
        "POST /api/plugin-ui/pr-review/start",
        "POST /api/plugin-ui/pr-review/rerun",
        "POST /api/plugin-ui/pr-review/cancel",
        "POST /api/plugin-ui/pr-review/delete",
        "POST /api/plugin-ui/pr-review/settings",
      ].sort(),
    );
  });

  it("holds the grants the flows need", () => {
    for (const p of [
      "provide_mcp_tools",
      "data_store",
      "models_read",
      "session_write",
      "session_read",
      "session_dispatch",
      "session_orchestrate",
      "user_authority",
      "contribute_sidebar",
    ]) {
      expect(manifest.permissions).toContain(p);
    }
  });

  it("names both tools within core's charset rule", () => {
    const names = manifest.mcp_tools.map((t: any) => t.name);
    expect(names).toEqual(["pr_review_step", "pr_review_submit"]);
    for (const n of names) expect(n).toMatch(/^[a-z0-9_]{1,64}$/);
    const submit = manifest.mcp_tools[1];
    expect(submit.input_schema.required).toEqual(["result"]);
    expect(submit.input_schema.properties.result.properties.verdict.enum).toEqual([
      "approve",
      "approve_with_comments",
      "request_changes",
    ]);
  });
});
