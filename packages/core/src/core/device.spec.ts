import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, hostname, platform } from "node:os";
import { join } from "node:path";

describe("core/device — getDeviceProfile and buildDeviceNotice", () => {
  let home: string;
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "agentnet-device-"));
    process.env.AGENTNET_HOME = home;
    delete process.env.AGENTNET_DEVICE_LABEL;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.unstubAllGlobals();
    rmSync(home, { recursive: true, force: true });
  });

  it("generates a new stable UUID on first call and caches/persists it", async () => {
    const { getDeviceProfile } = await import("./device.js");
    const p1 = await getDeviceProfile();
    expect(p1.id).toBeDefined();
    expect(p1.id.length).toBe(36); // standard UUID v4 length
    expect(p1.label).toBe(`${hostname()} (${platform()})`);

    // Verify it is persisted
    const deviceJsonPath = join(home, "device.json");
    expect(existsSync(deviceJsonPath)).toBe(true);
    const content = JSON.parse(readFileSync(deviceJsonPath, "utf8"));
    expect(content.id).toBe(p1.id);

    // Call again and verify it is stable
    const p2 = await getDeviceProfile();
    expect(p2.id).toBe(p1.id);
  });

  it("overrides the label via AGENTNET_DEVICE_LABEL env var", async () => {
    process.env.AGENTNET_DEVICE_LABEL = "Pixel 8 (Android)";
    const { getDeviceProfile } = await import("./device.js");
    const p = await getDeviceProfile();
    expect(p.label).toBe("Pixel 8 (Android)");
  });

  it("buildDeviceNotice formats the notice correctly with truncated ids", async () => {
    const { buildDeviceNotice } = await import("./device.js");
    const prev = { id: "1234567890abcdef1234567890abcdef", label: "My Desktop" };
    const cur = { id: "abcdef1234567890abcdef1234567890", label: "My Phone" };

    const notice = buildDeviceNotice(prev, cur);
    expect(notice).toContain('"My Desktop" (12345678)');
    expect(notice).toContain('"My Phone"');
    expect(notice).toContain("Absolute paths");
    expect(notice).toContain("Verify on THIS device");
  });
});
