import { describe, expect, it } from "vitest";
import { countFindings, validateResult } from "../src/validate";
import { validResult } from "./fixtures";
describe("validateResult", () => {
  it("accepts a valid result, sorts by severity and keeps praise last", () => {
    const v = validateResult(validResult());
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.result.findings.map((f) => f.severity ?? f.kind)).toEqual([
      "blocker",
      "minor",
      "praise",
    ]);
    expect(countFindings(v.result.findings)).toEqual({
      blocker: 1,
      major: 0,
      minor: 1,
      nit: 0,
      praise: 1,
    });
  });

  it("accepts a JSON-stringified result", () => {
    expect(validateResult(JSON.stringify(validResult())).ok).toBe(true);
  });

  it("collects every problem with its path", () => {
    const r = validResult();
    r.summary = "";
    r.verdict = "lgtm";
    r.findings[1].severity = "critical";
    r.findings[2].end_line = 2; // < line
    r.findings[2].confidence = 1.5;
    const v = validateResult(r);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const all = v.errors.join("\n");
    expect(all).toContain("result.summary");
    expect(all).toContain("result.verdict");
    expect(all).toContain("result.findings[1].severity");
    expect(all).toContain("result.findings[2].end_line");
    expect(all).toContain("result.findings[2].confidence");
  });

  it("rejects approve with a standing blocker", () => {
    const r = validResult();
    r.verdict = "approve";
    const v = validateResult(r);
    expect(v.ok).toBe(false);
  });

  it("rejects praise with a severity, too much praise, and a non-object", () => {
    const r = validResult();
    r.findings[0].severity = "nit";
    expect(validateResult(r).ok).toBe(false);

    const many = validResult();
    many.findings = Array.from({ length: 6 }, () => ({ ...validResult().findings[0] }));
    many.verdict = "approve";
    expect(validateResult(many).ok).toBe(false);

    expect(validateResult(42).ok).toBe(false);
    expect(validateResult("{not json").ok).toBe(false);
  });
});
