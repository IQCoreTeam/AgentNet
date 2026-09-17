// Opt-in transport acceptance. No engines, funded wallets, or chain transactions.
// pnpm --filter @iqlabs-official/agent-sdk exec tsx test/test-gdrive-device-pages.ts
// Add --local-smoke to verify the harness without Google access (NOT Drive proof).
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionStore, PAGE_SIZE } from "../src/account/store.js";
import { parseSessionPage } from "../src/account/devicePages.js";
import { manualStorage } from "../src/account/storage/manual.js";
import { mirrorStorage } from "../src/account/storage/mirror.js";
import { gdriveStorage } from "../src/account/storage/gdrive.js";
import { getAccessToken, isSignedIn } from "../src/account/storage/oauth.js";
import { rootDir } from "../src/core/paths.js";
import { testWallet } from "../src/account/keypairWallet.js";
import type {
  StorageAdapter,
  CanonicalSession,
} from "../src/runtime/contract.js";

const wallet = testWallet(247); // Public, unfunded fixture; only signs encryption challenges.
const localSmoke = process.argv.includes("--local-smoke");
const worker = process.argv.includes("--worker");
const file = fileURLToPath(import.meta.url);
const digest = (bytes: Uint8Array | null) =>
  createHash("sha256")
    .update(bytes ?? new Uint8Array())
    .digest("hex");

function fileCloud(dir: string): StorageAdapter {
  return {
    async list() {
      return readdir(dir);
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(join(dir, key)));
      } catch (e: any) {
        if (e.code === "ENOENT") return null;
        throw e;
      }
    },
    async put(key, bytes) {
      await writeFile(join(dir, key), bytes);
    },
    async remove(key) {
      await rm(join(dir, key), { force: true });
    },
  };
}
function transport(): StorageAdapter {
  return localSmoke
    ? fileCloud(process.env.QA_CLOUD_DIR!)
    : gdriveStorage(wallet.address);
}

async function workerMain() {
  const cloud = transport();
  let offline = false;
  const connected: StorageAdapter = {
    list: () =>
      offline ? Promise.reject(new Error("QA disconnected")) : cloud.list(),
    get: (key) =>
      offline ? Promise.reject(new Error("QA disconnected")) : cloud.get(key),
    put: (key, bytes) =>
      offline
        ? Promise.reject(new Error("QA disconnected"))
        : cloud.put(key, bytes),
    remove: (key) =>
      offline
        ? Promise.reject(new Error("QA disconnected"))
        : cloud.remove(key),
  };
  const mirror = mirrorStorage(manualStorage(wallet.address), connected);
  const store = new SessionStore(wallet, mirror);
  let queue = Promise.resolve();
  process.on("message", (input: any) => {
    queue = queue.then(async () => {
      try {
        const { action, sessionId, label } = input;
        let result: unknown;
        if (action === "write") {
          const meta = {
            sessionId,
            title: "Device-page Drive QA",
            cli: "claude" as const,
            ts: Date.now(),
          };
          // Each device crosses a page boundary independently.
          for (let i = 0; i <= PAGE_SIZE; i++)
            await store.appendMessage(meta, {
              role: "user",
              text: `${label}:${i}`,
              ts: Date.now(),
            });
          await mirror.backfill!();
          result = "uploaded";
        } else if (action === "offline") {
          offline = true;
          for (let i = 0; i < 2; i++)
            await store.appendMessage(
              {
                sessionId,
                title: "Device-page Drive QA",
                cli: "claude",
                ts: Date.now(),
              },
              { role: "user", text: `${label}:오프라인:${i}`, ts: Date.now() },
            );
          result = "local only";
        } else if (action === "reconnect") {
          offline = false;
          result = await mirror.backfill!();
        } else if (action === "read") {
          const session = await store.load(sessionId);
          const latest = await store.loadLatest(sessionId);
          let page = latest;
          const pages = [page.messages];
          while (page.hasMore && page.cursor !== null) {
            page = await store.loadOlder(sessionId, page.cursor);
            pages.unshift(page.messages);
          }
          assert.deepEqual(pages.flat(), session?.messages);
          result = {
            messages: session?.messages.map((m) => m.text),
            sessions: (await store.listMine()).filter(
              (s) => s.sessionId === sessionId,
            ).length,
          };
        } else throw new Error(`Unknown action ${action}`);
        process.send!({ id: input.id, result });
      } catch (e) {
        process.send!({
          id: input.id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    });
  });
}

function client(home: string, cloudDir: string) {
  const child = fork(
    file,
    ["--worker", ...(localSmoke ? ["--local-smoke"] : [])],
    {
      env: { ...process.env, AGENTNET_HOME: home, QA_CLOUD_DIR: cloudDir },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    },
  );
  const pending = new Map<
    string,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  child.on("message", (message: any) => {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error));
    else request.resolve(message.result);
  });
  child.on("exit", () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("QA worker exited"));
    }
    pending.clear();
  });
  return {
    child,
    request: (
      action: string,
      sessionId: string,
      label?: string,
    ): Promise<any> =>
      new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`QA ${action} timed out`));
        }, 120_000);
        pending.set(id, { resolve, reject, timer });
        child.send({ id, action, sessionId, label });
      }),
  };
}

async function main() {
  const authHome = rootDir();
  if (!localSmoke) {
    if (!(await isSignedIn()))
      throw new Error(
        "Google Drive is not connected. Connect Google in AgentNet first; no test files were created.",
      );
    await getAccessToken(); // Validate/refresh before creating any test data; never print credentials.
  }
  const root = await mkdtemp(join(tmpdir(), "agentnet-drive-qa-"));
  const sessionId = `qa-device-pages-${randomUUID()}`;
  const cloudDir = join(root, "cloud");
  await mkdir(cloudDir);
  process.env.QA_CLOUD_DIR = cloudDir;
  const cloud = transport();
  const children: ChildProcess[] = [];
  const create = async (label: string) => {
    const home = join(root, label);
    await mkdir(home, { mode: 0o700 });
    if (!localSmoke) {
      // Share the existing authorized OAuth setup without copying credentials.
      // Session files and generated device IDs stay isolated per process.
      for (const name of ["tokens", "config.json"]) {
        try {
          await access(join(authHome, name));
        } catch {
          continue;
        }
        await symlink(join(authHome, name), join(home, name));
      }
    }
    const c = client(home, cloudDir);
    children.push(c.child);
    return c;
  };
  const report: Record<string, unknown> = {
    transport: localSmoke ? "local-files-NOT-Drive" : "Google Drive",
    sessionId,
    physicalHosts: 1,
    independentDeviceProcesses: 2,
  };
  try {
    // Create the legacy fixture in memory, then upload once. No user history copied.
    const blobs = new Map<string, Uint8Array>();
    const memory: StorageAdapter = {
      list: async () => [...blobs.keys()],
      get: async (k) => blobs.get(k) ?? null,
      put: async (k, v) => {
        blobs.set(k, v);
      },
      remove: async (k) => {
        blobs.delete(k);
      },
    };
    const seed = new SessionStore(wallet, memory);
    const meta: Omit<CanonicalSession, "messages"> = {
      sessionId,
      title: "Device-page Drive QA",
      cli: "claude",
      ts: Date.now(),
    };
    for (let i = 0; i < PAGE_SIZE; i++)
      await seed.appendMessage(meta, {
        role: "user",
        text: `legacy:${i}`,
        ts: Date.now(),
      });
    const legacyKey = `${sessionId}__p0`,
      legacyBytes = blobs.get(legacyKey)!;
    await cloud.put(legacyKey, legacyBytes); // Also initializes the shared Drive folder before concurrent writers.
    const [a, b] = await Promise.all([create("device-a"), create("device-b")]);
    await Promise.all([
      a.request("write", sessionId, "A"),
      b.request("write", sessionId, "B"),
    ]);
    const keys = (await cloud.list()).filter(
      (k) => parseSessionPage(k)?.sessionId === sessionId,
    );
    assert.equal(
      new Set(keys.map((k) => parseSessionPage(k)!.writer).filter(Boolean))
        .size,
      2,
    );
    const sealed = new Map<string, string>();
    for (const key of keys.filter((k) => parseSessionPage(k)!.page === 0))
      sealed.set(key, digest(await cloud.get(key)));
    const expected = [
      ...Array.from({ length: PAGE_SIZE }, (_, i) => `legacy:${i}`),
      ...["A", "B"].flatMap((label) =>
        Array.from({ length: PAGE_SIZE + 1 }, (_, i) => `${label}:${i}`),
      ),
    ];
    const reader = await create("fresh-reader");
    const before = await reader.request("read", sessionId);
    assert.deepEqual([...before.messages].sort(), [...expected].sort());
    assert.equal(before.sessions, 1);
    await Promise.all([
      a.request("offline", sessionId, "A"),
      b.request("offline", sessionId, "B"),
    ]);
    const offline = await reader.request("read", sessionId);
    assert.deepEqual(offline.messages, before.messages);
    await Promise.all([
      a.request("reconnect", sessionId),
      b.request("reconnect", sessionId),
    ]);
    expected.push(
      ...["A", "B"].flatMap((label) =>
        [0, 1].map((i) => `${label}:오프라인:${i}`),
      ),
    );
    const finalReader = await create("fresh-after-reconnect");
    const final = await finalReader.request("read", sessionId);
    assert.deepEqual([...final.messages].sort(), expected.sort());
    assert.equal(final.sessions, 1);
    assert.equal(digest(await cloud.get(legacyKey)), digest(legacyBytes));
    for (const [key, hash] of sealed)
      assert.equal(digest(await cloud.get(key)), hash);
    Object.assign(report, {
      result: "PASS",
      onlineMessages: before.messages.length,
      afterReconnectMessages: final.messages.length,
      canonicalSessions: final.sessions,
      pagination: "matches full load",
      sealedPages: "unchanged",
      legacyPage: "unchanged",
    });
  } finally {
    await Promise.all(
      children.map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolve();
              return;
            }
            child.once("exit", () => resolve());
            child.kill();
          }),
      ),
    );
    // Delete only this run's uniquely named fixture pages, never entire folders.
    try {
      const keys = (await cloud.list()).filter(
        (k) => parseSessionPage(k)?.sessionId === sessionId,
      );
      for (const key of keys) await cloud.remove(key);
      assert.equal(
        (await cloud.list()).filter(
          (k) => parseSessionPage(k)?.sessionId === sessionId,
        ).length,
        0,
      );
      report.cleanup = "verified";
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify(report, null, 2));
}

if (worker) void workerMain();
else
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exitCode = 1;
  });
