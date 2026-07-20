// Wallet-scoped equip state — WHICH owned skills this wallet has un-equipped (disposed).
//
// Ownership truth lives on-chain (the wallet's soulbound tokens) and the SKILL.md folders
// are a materialization of it, but the wallet's choice to un-equip an owned skill exists
// nowhere on-chain (soulbound tokens can't be sold or burned). This module owns that one
// piece of state:
//
//   local:  ~/.agentnet/skill-state/{wallet}.json          (per wallet, this device)
//   cloud:  ONE small encrypted blob (key "skill-state") in the wallet's cloud storage,
//           next to its session blobs, so the choice follows the wallet across devices
//           exactly like sessions do.
//
// Sync is event-driven, never polled: login() calls syncEquipState (pull + last-write-wins
// merge + register a pusher), and each dispose/re-equip writes locally then fires a
// debounced push. No timers beyond the debounce, no extra RPC.
//
// This replaces the legacy device-global manifest.disposed list in skills.json
// (registry.ts keeps that file as the folder-origin record only). A legacy non-empty
// disposed list is adopted the first time a wallet's state file is read.

import { readFile, writeFile } from "node:fs/promises";
import { skillStateDir, skillStateFile, ensureDir } from "../core/paths.js";
import { deriveSessionKey, encryptForWallet, decryptForWallet, type SessionKey } from "../core/crypto.js";
import type { StorageAdapter, Wallet } from "../runtime/contract.js";
import { readSkillManifest } from "./registry.js";

/** Reserved blob id in the wallet's storage. Safe next to session pages: the session
 *  store only interprets "{sessionId}__p{N}" keys and ignores everything else. */
export const SKILL_STATE_KEY = "skill-state";

interface EquipState {
  version: 1;
  updatedAt: number; // epoch ms of the last mutation — the last-write-wins merge key
  disposed: string[]; // mints the wallet owns but chose to un-equip
}

// Adopted legacy state gets a fixed ancient timestamp: real state (local or cloud)
// always wins the merge over it, but it still pushes when nothing else exists.
const LEGACY_ADOPTED_AT = 1;

async function readState(wallet: string): Promise<EquipState> {
  try {
    const parsed = JSON.parse(await readFile(skillStateFile(wallet), "utf8")) as Partial<EquipState>;
    return { version: 1, updatedAt: parsed.updatedAt ?? 0, disposed: parsed.disposed ?? [] };
  } catch {
    // First read for this wallet: adopt the legacy device-global disposed list once.
    // Harmless if it names mints this wallet never owned — disposed only ever filters
    // the wallet's own owned set.
    const legacy = (await readSkillManifest().catch(() => ({ disposed: [] as string[] }))).disposed;
    return { version: 1, updatedAt: legacy.length ? LEGACY_ADOPTED_AT : 0, disposed: [...legacy] };
  }
}

/** Plain file write — no push. Mutators write-then-push; the merge adopting a fresher
 *  cloud state writes only (the cloud already has it). */
async function writeLocal(wallet: string, state: EquipState): Promise<void> {
  await ensureDir(skillStateDir());
  await writeFile(skillStateFile(wallet), JSON.stringify(state, null, 2));
}

// ── cloud push (registered per wallet by syncEquipState; absent = local-only mode) ──

type Pusher = (state: EquipState) => Promise<void>;
const pushers = new Map<string, Pusher>();
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PUSH_DEBOUNCE_MS = 2500; // same cadence as the session mirror's cloud flush

function schedulePush(wallet: string): void {
  const push = pushers.get(wallet);
  if (!push) return;
  clearTimeout(pushTimers.get(wallet));
  pushTimers.set(
    wallet,
    setTimeout(() => {
      pushTimers.delete(wallet);
      void readState(wallet).then((s) => push(s)).catch(() => {});
    }, PUSH_DEBOUNCE_MS),
  );
}

/** The mints this wallet has un-equipped. Best-effort (missing file = empty). */
export async function readDisposed(wallet: string): Promise<Set<string>> {
  return new Set((await readState(wallet)).disposed);
}

/** Record an un-equip. Idempotent; writes locally and schedules a cloud push. */
export async function disposeMint(wallet: string, mint: string): Promise<void> {
  const s = await readState(wallet);
  if (s.disposed.includes(mint)) return;
  s.disposed.push(mint);
  s.updatedAt = Date.now();
  await writeLocal(wallet, s);
  schedulePush(wallet);
}

/** Undo an un-equip (re-equip). Idempotent; writes locally and schedules a cloud push. */
export async function undisposeMint(wallet: string, mint: string): Promise<void> {
  const s = await readState(wallet);
  if (!s.disposed.includes(mint)) return;
  s.disposed = s.disposed.filter((m) => m !== mint);
  s.updatedAt = Date.now();
  await writeLocal(wallet, s);
  schedulePush(wallet);
}

/**
 * Bind this wallet's equip state to its cloud storage — called once per connect (login()).
 * Pulls the cloud blob, merges last-write-wins by updatedAt, and registers the pusher that
 * later dispose/re-equip writes flush through. No cloud configured → local-only, no-op.
 *
 * The blob is encrypted with the wallet-derived session key, same as session blobs. The
 * key derivation is lazy AND free of extra prompts: webWallet replays the signature it
 * cached at connect (deriveX25519Keypair always signs the same fixed message).
 */
export async function syncEquipState(wallet: Wallet, cloud: StorageAdapter | undefined): Promise<void> {
  if (!cloud) return;
  const addr = wallet.address;
  let keyP: Promise<SessionKey> | null = null;
  const getKey = () => (keyP ??= deriveSessionKey(wallet));

  pushers.set(addr, async (s) => {
    const key = await getKey();
    await cloud.put(SKILL_STATE_KEY, await encryptForWallet(key, new TextEncoder().encode(JSON.stringify(s))));
  });

  const local = await readState(addr);
  const blob = await cloud.get(SKILL_STATE_KEY).catch(() => null);
  let remote: EquipState | null = null;
  if (blob) {
    try {
      const parsed = JSON.parse(
        new TextDecoder().decode(await decryptForWallet(await getKey(), blob)),
      ) as Partial<EquipState>;
      remote = { version: 1, updatedAt: parsed.updatedAt ?? 0, disposed: parsed.disposed ?? [] };
    } catch {
      remote = null; // unreadable blob: keep local, let the next push overwrite it
    }
  }

  if (remote && remote.updatedAt > local.updatedAt) {
    await writeLocal(addr, remote); // cloud is fresher — adopt it, nothing to push
  } else if (local.updatedAt > (remote?.updatedAt ?? 0)) {
    await pushers.get(addr)!(local).catch(() => {}); // this device is fresher — publish it
  }
}
