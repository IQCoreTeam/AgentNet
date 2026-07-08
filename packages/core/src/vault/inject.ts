// Startup inject for foreign hosts (plans/soul-memory-portability.md §6 steps 3–5).
// "Connect = the outfit follows": the moment a host spawns our stdio server with a
// wallet, the wallet's soul and memory are reconciled into that host's native files —
// no host-side code needed. Best-effort throughout: an inject hiccup must never stop
// the server from coming up (the vault TOOLS still work either way).
//
// Hosts covered:
//   OpenClaw — workspace SOUL.md two-way sync + MEMORY.md fenced block (its workspace
//              dir doubles as the memory "project", so memory_save(project=workspace)
//              and this inject close the loop). Only when the workspace dir exists.
//   Eliza    — character.json persona merge, only when AGENTNET_ELIZA_CHARACTER names
//              the file (Eliza has no fixed character path convention).
//   Hermes   — deliberately NOT here yet: its markdown context path needs verifying
//              against a live install first (plan §7); Hermes agents use the vault
//              tools meanwhile.

import { access } from "node:fs/promises";
import { join } from "node:path";
import { openclawHome, openclawWorkspaceDir } from "../core/paths.js";
import { MemoryStore } from "../memory/store.js";
import { writeOpenclawMemory } from "../memory/convert/openclaw.js";
import { SoulStore } from "../soul/store.js";
import { syncSoulWithFile } from "../soul/convert/openclaw.js";
import { writeElizaCharacter } from "../soul/convert/eliza.js";
import type { VaultDeps } from "./tools.js";

const exists = (p: string) => access(p).then(() => true).catch(() => false);

/** Reconcile soul + memory into every detected host's native files. Returns log lines
 *  describing what happened (for the server's stderr); failures become log lines too. */
export async function injectExternalHosts(deps: VaultDeps): Promise<string[]> {
  const log: string[] = [];
  const souls = new SoulStore(deps.wallet, deps.storage);

  // OpenClaw: only a real workspace gets files (never invent one — its absence means
  // OpenClaw isn't set up here, and a surprise ~/.openclaw would be junk).
  if ((await exists(openclawHome())) && (await exists(openclawWorkspaceDir()))) {
    const ws = openclawWorkspaceDir();
    try {
      const action = await syncSoulWithFile(souls, join(ws, "SOUL.md"));
      if (action !== "none") log.push(`openclaw soul: ${action}`);
    } catch (err: any) {
      log.push(`openclaw soul sync failed: ${err.message}`);
    }
    try {
      const mem = await new MemoryStore(deps.wallet, deps.storage).load(ws);
      await writeOpenclawMemory(ws, mem);
      if (mem.records.length > 0) log.push(`openclaw memory: injected ${mem.records.length} record(s)`);
    } catch (err: any) {
      log.push(`openclaw memory inject failed: ${err.message}`);
    }
  }

  // Eliza: explicit opt-in via the character-file path.
  const elizaCharacter = process.env.AGENTNET_ELIZA_CHARACTER?.trim();
  if (elizaCharacter) {
    try {
      const doc = await souls.load();
      if (doc) {
        await writeElizaCharacter(elizaCharacter, doc.text);
        log.push(`eliza persona: injected into ${elizaCharacter}`);
      }
    } catch (err: any) {
      log.push(`eliza persona inject failed: ${err.message}`);
    }
  }

  return log;
}
