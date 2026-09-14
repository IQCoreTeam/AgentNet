import { expect, it } from "vitest";
import { engineStatus } from "../../../surfaces/webview/src/state/store";

it("Custom inherits missing runtime status but not Codex login requirements", () => {
  const state = { customEngine: { masked: "fixture.invalid" }, cliReport: { claude: "ok", codex: "node-missing" } };
  expect(engineStatus(state, "custom")).toBe("node-missing");
  expect(engineStatus({ ...state, cliReport: { claude: "ok", codex: "no-login" } }, "custom")).toBe("ok");
});
