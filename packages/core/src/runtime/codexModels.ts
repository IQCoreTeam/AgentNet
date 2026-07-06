import { spawn } from "node:child_process";
import readline from "node:readline";
import type { ChatModelOption } from "../chat/modelOptions.js";
import type { Model } from "./codex_bindings/v2/Model.js";
import type { ModelListResponse } from "./codex_bindings/v2/ModelListResponse.js";
import { getCodexApiKey } from "../account/codexAuth.js";
import { resolveExecutable } from "./resolveExecutable.js";

function modelToOption(model: Model): ChatModelOption {
  const display = model.displayName?.trim() || model.model;
  const desc = model.description?.trim();
  const extra = `exact value: ${model.model}`;
  return {
    value: model.model,
    chipLabel: display,
    label: display,
    description: desc ? `${desc} · ${extra}` : extra,
  };
}

export async function listCodexModelOptions(): Promise<ChatModelOption[]> {
  const codexPath = resolveExecutable("codex") || "codex";
  const apiKey = await getCodexApiKey().catch(() => null);
  const childEnv = { ...process.env };
  if (apiKey) childEnv.OPENAI_API_KEY = apiKey;

  const child = spawn(codexPath, ["app-server", "--stdio"], {
    env: childEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  let nextRpcId = 1;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();
  const stderr: string[] = [];

  const rl = readline.createInterface({ input: child.stdout });
  rl.on("line", (line) => {
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const p = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(msg.error.message || "Codex RPC error"));
        else p.resolve(msg.result);
      }
    } catch {
      // ignore malformed lines; codex app-server uses one JSON-RPC message per line
    }
  });

  child.stderr.on("data", (d) => {
    const text = d.toString().trim();
    if (text) stderr.push(text);
  });

  const failPending = (err: Error) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  const exitPromise = new Promise<never>((_, reject) => {
    child.once("error", (err) => reject(err));
    child.once("exit", (code) => {
      if (code === 0 || code === null) return;
      reject(new Error(stderr[0] || `codex app-server exited with code ${code}`));
    });
  });

  function sendRequest(method: string, params: any): Promise<any> {
    const id = nextRpcId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
  }

  const timeoutMs = 8000;
  let timeoutId: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timeoutId = null;
      reject(new Error("Timed out while loading Codex models"));
    }, timeoutMs);
  });

  try {
    await Promise.race([
      sendRequest("initialize", {
        clientInfo: { name: "AgentNet", title: "AgentNet VSCode", version: "0.1.0" },
        capabilities: { experimentalApi: true, requestAttestation: false },
      }),
      exitPromise,
      timeout,
    ]);

    const all: Model[] = [];
    let cursor: string | null | undefined = undefined;
    while (true) {
      const page = (await Promise.race([
        sendRequest("model/list", { cursor, includeHidden: false, limit: 100 }),
        exitPromise,
        timeout,
      ])) as ModelListResponse;
      all.push(...(page.data || []).filter((m) => !m.hidden));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    // Float the app-server's own default model to the front so it becomes the picker's
    // default selection, shown by its real name (no opaque "default" pseudo-entry).
    const def = all.find((m) => m.isDefault);
    const ordered = def ? [def, ...all.filter((m) => m !== def)] : all;
    return ordered.map(modelToOption);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    failPending(new Error("Codex model-list request aborted"));
    rl.close();
    child.kill();
  }
}
