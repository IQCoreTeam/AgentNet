import { describe, it, expect } from "vitest";
import { compose } from "./compose.js";
import { type ValidationAdapter, emptyResult, addIssue } from "./types.js";

// Helper: build a stub adapter that returns predetermined issues
function makeAdapter(id: string, errors: string[], warnings: string[] = []): ValidationAdapter {
  return {
    id,
    async checkFormat() {
      const result = emptyResult();
      for (const msg of errors) addIssue(result, { field: "test", severity: "error", message: msg });
      for (const msg of warnings) addIssue(result, { field: "test", severity: "warning", message: msg });
      return result;
    },
  };
}

describe("validation/compose", () => {
  it("should pass when all adapters pass", async () => {
    const a = makeAdapter("a", []);
    const b = makeAdapter("b", []);
    const composed = compose(a, b);
    const r = await composed.checkFormat("any text");
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it("should fail-fast — stop after first adapter with errors", async () => {
    let bCalled = false;
    const a = makeAdapter("a", ["error from a"]);
    const b: ValidationAdapter = {
      id: "b",
      async checkFormat() {
        bCalled = true;
        return emptyResult();
      },
    };

    const composed = compose(a, b); // failFast: true by default
    const r = await composed.checkFormat("text");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.message === "error from a")).toBe(true);
    expect(bCalled).toBe(false);
  });

  it("should collect from all adapters when failFast: false", async () => {
    const a = makeAdapter("a", ["error from a"]);
    const b = makeAdapter("b", ["error from b"]);

    const composed = compose(a, b, { failFast: false });
    const r = await composed.checkFormat("text");
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0].message).toBe("error from a");
    expect(r.errors[1].message).toBe("error from b");
  });

  it("should merge warnings from all adapters (even with failFast)", async () => {
    const a = makeAdapter("a", [], ["warn from a"]);
    const b = makeAdapter("b", [], ["warn from b"]);
    const composed = compose(a, b);
    const r = await composed.checkFormat("text");
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(2);
  });

  it("should include adapter ids in composed id", async () => {
    const a = makeAdapter("first", []);
    const b = makeAdapter("second", []);
    const composed = compose(a, b);
    expect(composed.id).toContain("first");
    expect(composed.id).toContain("second");
  });
});
