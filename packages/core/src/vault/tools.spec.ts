// Vault tools (soul_get/soul_set/memory_list/memory_save) — the self-serve identity
// door for external hosts. Tests run against an in-memory StorageAdapter and a real
// generated keypair (key derivation + encrypt/decrypt are local, no network), with
// AGENTNET_HOME isolated so the lastWriter device profile never touches ~/.agentnet.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import type { StorageAdapter, Wallet } from "../runtime/contract.js";

function memStorage(): StorageAdapter & { blobs: Map<string, Uint8Array> } {
  const blobs = new Map<string, Uint8Array>();
  return {
    blobs,
    async put(k, b) { blobs.set(k, b); },
    async get(k) { return blobs.get(k) ?? null; },
    async list() { return [...blobs.keys()]; },
    async remove(k) { blobs.delete(k); },
  };
}

describe("vault tools", () => {
  let home: string;
  let wallet: Wallet;
  let storage: ReturnType<typeof memStorage>;
  let tools: typeof import("./tools.js");
  const origEnv = { ...process.env };

  beforeEach(async () => {
    vi.resetModules();
    home = mkdtempSync(join(tmpdir(), "agentnet-vault-"));
    process.env.AGENTNET_HOME = home;
    process.env.AGENTNET_DEVICE_LABEL = "qa-box";
    const { keypairWallet } = await import("../account/keypairWallet.js");
    wallet = keypairWallet(Keypair.generate());
    storage = memStorage();
    tools = await import("./tools.js");
  });

  afterEach(() => {
    process.env = { ...origEnv };
    rmSync(home, { recursive: true, force: true });
  });

  const call = (name: string, args: any = {}) =>
    tools.handleVaultToolCall({ wallet, storage }, name, args);

  it("exposes exactly the four vault tools with generated schemas", () => {
    const defs = tools.getVaultTools();
    expect(defs.map((t) => t.name)).toEqual(["soul_get", "soul_set", "memory_list", "memory_save"]);
    const save = defs.find((t) => t.name === "memory_save")!.inputSchema as any;
    expect(save.required.sort()).toEqual(["body", "description", "name", "project"]);
    expect(save.required).not.toContain("type");
  });

  it("soul_get before any soul_set reports no soul, not an error", async () => {
    const r = await call("soul_get");
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain("No soul document stored yet");
  });

  it("soul_set → soul_get round-trips the text and stamps this device as lastWriter", async () => {
    const text = "# Name\nQA Agent\n\n## Style\n- terse\n\n## Custom Section\nsurvives verbatim";
    const set = await call("soul_set", { text });
    expect(set.isError).toBeUndefined();
    expect(set.content[0].text).toContain('"qa-box"');

    const got = await call("soul_get");
    expect(got.content[0].text).toContain(text);
    expect(got.content[0].text).toContain('last written by "qa-box"');
  });

  it("stores the soul encrypted — the blob never contains the plaintext", async () => {
    await call("soul_set", { text: "secret persona prose" });
    const { SOUL_KEY } = await import("../soul/store.js");
    const blob = new TextDecoder().decode(storage.blobs.get(SOUL_KEY)!);
    expect(blob).not.toContain("secret persona prose");
  });

  it("soul_set rejects text over the size cap as a tool error", async () => {
    const { SOUL_TEXT_MAX } = await import("../soul/store.js");
    const r = await call("soul_set", { text: "x".repeat(SOUL_TEXT_MAX + 1) });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("too long");
  });

  it("memory_list on a fresh project reports no records", async () => {
    const r = await call("memory_list", { project: "/tmp/proj" });
    expect(r.content[0].text).toContain("No memory records");
  });

  it("memory_save creates, memory_save with the same name updates, memory_list shows both states", async () => {
    const saved = await call("memory_save", {
      project: "/tmp/proj",
      name: "user-prefers-korean",
      description: "User speaks Korean",
      body: "Answer in Korean.",
      type: "user",
    });
    expect(saved.content[0].text).toContain('Saved memory record "user-prefers-korean"');

    const updated = await call("memory_save", {
      project: "/tmp/proj",
      name: "user-prefers-korean",
      description: "User speaks Korean",
      body: "Answer in Korean; commit messages in English.",
      type: "user",
    });
    expect(updated.content[0].text).toContain("Updated");
    expect(updated.content[0].text).toContain("1 record(s) total");

    const list = await call("memory_list", { project: "/tmp/proj" });
    expect(list.content[0].text).toContain("commit messages in English");
    expect(list.content[0].text).toContain("(user)");
    // Different project = different blob: nothing leaks across projects.
    const other = await call("memory_list", { project: "/tmp/other" });
    expect(other.content[0].text).toContain("No memory records");
  });

  it("memory_save defaults an unknown/missing type to project", async () => {
    await call("memory_save", { project: "/p", name: "a", description: "d", body: "b" });
    const list = await call("memory_list", { project: "/p" });
    expect(list.content[0].text).toContain("(project)");
  });

  it("throws on unknown tool names (the server routes only VAULT_TOOL_NAMES here)", async () => {
    expect(tools.VAULT_TOOL_NAMES.has("soul_get")).toBe(true);
    expect(tools.VAULT_TOOL_NAMES.has("buy_skill")).toBe(false);
    await expect(call("nope")).rejects.toThrow("Unknown vault tool");
  });
});
