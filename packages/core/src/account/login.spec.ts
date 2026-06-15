import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { logout } from "./login.js";
import { tokenFile, configFile, sessionsDir } from "../core/paths.js";
import { saveCodexApiKey, getCodexApiKey } from "./codexAuth.js";
import { ephemeralKey, persistedKey, type KeyVault } from "./keyPolicy.js";
import type { SessionKey } from "../core/crypto.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "agentnet-test-login-"));
  process.env.AGENTNET_HOME = home;
  // Make sure directories exist
  mkdirSync(join(home, "tokens"), { recursive: true });
  mkdirSync(join(home, "sessions"), { recursive: true });
});

afterEach(() => {
  delete process.env.AGENTNET_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe("unified logout logic", () => {
  it("soft logout disconnects cloud but preserves session files and Codex API key", async () => {
    // Setup
    writeFileSync(configFile(), JSON.stringify({ kind: "gdrive", google_client_id: "client-id" }));
    writeFileSync(tokenFile("google"), JSON.stringify({ access_token: "tok" }));
    
    const walletAddress = "5ey2ja1KstPwMQRx7EokG2dfJksAGGPA";
    const sessionWalletDir = join(sessionsDir(), walletAddress);
    mkdirSync(sessionWalletDir, { recursive: true });
    writeFileSync(join(sessionWalletDir, "history.bin"), "some history data");

    await saveCodexApiKey("fake-codex-key");

    // Perform soft logout
    await logout({ policy: "soft" });

    // Assert cloud disconnected
    expect(existsSync(tokenFile("google"))).toBe(false);
    
    // Config file should only retain app credentials (google_client_id)
    const configData = JSON.parse(readFileSyncText(configFile()));
    expect(configData.kind).toBeUndefined();
    expect(configData.google_client_id).toBe("client-id");

    // Assert session files and Codex API key are preserved
    expect(existsSync(join(sessionWalletDir, "history.bin"))).toBe(true);
    expect(await getCodexApiKey()).toBe("fake-codex-key");
  });

  it("full logout disconnects cloud, deletes address-specific session logs, and wipes Codex API key", async () => {
    // Setup
    writeFileSync(configFile(), JSON.stringify({ kind: "gdrive", google_client_id: "client-id" }));
    writeFileSync(tokenFile("google"), JSON.stringify({ access_token: "tok" }));
    
    const walletAddress = "5ey2ja1KstPwMQRx7EokG2dfJksAGGPA";
    const sessionWalletDir = join(sessionsDir(), walletAddress);
    mkdirSync(sessionWalletDir, { recursive: true });
    writeFileSync(join(sessionWalletDir, "history.bin"), "some history data");

    // Another wallet's session should NOT be wiped
    const otherWalletAddress = "otherAddress123";
    const otherSessionWalletDir = join(sessionsDir(), otherWalletAddress);
    mkdirSync(otherSessionWalletDir, { recursive: true });
    writeFileSync(join(otherSessionWalletDir, "history.bin"), "other data");

    await saveCodexApiKey("fake-codex-key");

    // Perform full logout
    await logout({ policy: "full", address: walletAddress });

    // Assert cloud disconnected
    expect(existsSync(tokenFile("google"))).toBe(false);

    // Assert target wallet session files are wiped
    expect(existsSync(join(sessionWalletDir, "history.bin"))).toBe(false);
    expect(existsSync(sessionWalletDir)).toBe(false);

    // Assert other wallet session files are preserved
    expect(existsSync(join(otherSessionWalletDir, "history.bin"))).toBe(true);

    // Assert Codex API key is wiped
    expect(await getCodexApiKey()).toBeNull();
  });

  it("calls KeyPolicy clear under soft and full logout", async () => {
    // Setup mock KeyVault
    const mockVault: KeyVault = {
      read: vi.fn(),
      write: vi.fn(),
      remove: vi.fn(),
    };

    const policy = persistedKey(mockVault);
    const walletAddress = "5ey2ja1KstPwMQRx7EokG2dfJksAGGPA";

    // Test soft logout
    await logout({ policy: "soft", keyPolicy: policy });
    // Soft logout calls clear() without address, which clears in-memory but doesn't call vault.remove
    expect(mockVault.remove).not.toHaveBeenCalled();

    // Test full logout
    await logout({ policy: "full", address: walletAddress, keyPolicy: policy });
    // Full logout should call clear(address) which invokes vault.remove(address)
    expect(mockVault.remove).toHaveBeenCalledWith(walletAddress);
  });
});

import { readFileSync } from "node:fs";
function readFileSyncText(path: string): string {
  return readFileSync(path, "utf8");
}
