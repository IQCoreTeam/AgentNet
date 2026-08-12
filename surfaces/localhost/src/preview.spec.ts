import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePreviewPort, previewStatusMsg, isLoopback } from "./preview.js";

test("validatePreviewPort accepts real loopback dev-server ports", () => {
  assert.equal(validatePreviewPort(3000, 4317), 3000);
  assert.equal(validatePreviewPort(8080, 4317), 8080);
  assert.equal(validatePreviewPort(65535, 4317), 65535);
});

test("validatePreviewPort treats null as an explicit clear", () => {
  assert.equal(validatePreviewPort(null, 4317), null);
});

test("validatePreviewPort rejects bad ports, non-integers, strings, missing, and the server's own port", () => {
  for (const bad of [0, -1, 70000, 3000.5, "5173", undefined, {}, NaN]) {
    assert.equal(validatePreviewPort(bad, 4317), false, `expected ${String(bad)} to be rejected`);
  }
  assert.equal(validatePreviewPort(4317, 4317), false); // can't frame the server itself
});

test("previewStatusMsg is the single source of truth for the payload", () => {
  assert.deepEqual(previewStatusMsg(5173), { type: "previewStatus", port: 5173, url: "http://127.0.0.1:5173/" });
  assert.deepEqual(previewStatusMsg(null), { type: "previewStatus", port: null, url: null });
});

test("isLoopback accepts only the device's own loopback", () => {
  for (const ok of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "127.5.5.5"]) assert.equal(isLoopback(ok), true);
  for (const no of ["192.168.1.5", "10.0.0.1", "0.0.0.0", ""]) assert.equal(isLoopback(no), false);
});
