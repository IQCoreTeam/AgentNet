import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ClientMessage, Cli, ServerMessage } from "../transport/protocol";
import { StoreProvider, useStore } from "./store";
import { DEFAULT_SELECTION_PREFERENCES, readSelectionPreferences, writeSelectionPreferences } from "./selectionPreferences";

const harness = vi.hoisted(() => ({
  emit: null as ((msg: ServerMessage) => void) | null,
  onPost: null as ((msg: ClientMessage) => void) | null,
  onReopen: null as (() => void) | null,
  posts: [] as ClientMessage[],
  reopens: 0,
}));

vi.mock("../transport/client", () => ({
  Transport: class {
    onEvent(cb: (msg: ServerMessage) => void) { harness.emit = cb; return () => { harness.emit = null; }; }
    open() { harness.onReopen?.(); }
    reopen() { harness.reopens += 1; harness.onReopen?.(); }
    close() {}
    getClientId() { return "synthetic-refresh"; }
    async post(msg: ClientMessage) { harness.posts.push(msg); harness.onPost?.(msg); }
  },
}));

afterEach(() => {
  localStorage.clear();
  harness.posts = [];
  harness.reopens = 0;
  harness.onPost = null;
  harness.onReopen = null;
});

it("restores saved selections after the new client handshake without persisting intermediate defaults", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeSelectionPreferences(null, {
    cli: "codex",
    modelByCli: { claude: "sonnet", codex: "gpt-5-codex", custom: "default" },
    effortByCli: { claude: "medium", codex: "xhigh", custom: "default" },
  });
  let cli: Cli = "claude";
  const settings: Record<Cli, { model?: string; effort?: string; mode?: string }> = { claude: { mode: "acceptEdits" }, codex: { mode: "auto" }, custom: { mode: "auto" } };
  harness.onReopen = () => {
    cli = "claude";
    settings.claude = { mode: "acceptEdits" };
    settings.codex = { mode: "auto" };
    settings.custom = { mode: "auto" };
  };
  const snapshot = (requestId?: string): ServerMessage => ({ type: "settings", cli, ...settings[cli], requestId });
  harness.onPost = msg => {
    if (msg.type === "platform") cli = msg.cli;
    if (msg.type === "model") {
      settings[cli].model = msg.model;
      if (msg.model === "haiku") harness.emit?.({ type: "modelOptions", cli, options: [{ value: "haiku", chipLabel: "Haiku", label: "Haiku", description: "synthetic catalog", supportedEfforts: ["low"] }] });
    }
    if (msg.type === "effort") settings[cli].effort = msg.effort === "unsupported" ? undefined : msg.effort;
    if (msg.type === "mode") settings[cli].mode = msg.mode;
    if (msg.type === "ready" || msg.type === "platform" || msg.type === "model" || msg.type === "effort" || msg.type === "mode") harness.emit?.(snapshot());
    if (msg.type === "getSettings") harness.emit?.(snapshot(msg.requestId));
  };
  let store: ReturnType<typeof useStore> | undefined;
  function Observer() { store = useStore(); return null; }
  const host = document.createElement("div");
  document.body.append(host);
  let root = createRoot(host);
  try {
    await act(async () => root.render(<StoreProvider><Observer /></StoreProvider>));
    expect(store!.state.modelByCli.codex).toBe("gpt-5-codex");
    expect(readSelectionPreferences(null).modelByCli.codex).toBe("gpt-5-codex");

    await act(async () => {
      harness.emit?.({ type: "init", hasWallet: false, defaultPath: null, cloudKind: null });
      harness.emit?.({ type: "cliStatus", claude: "ok", codex: "ok" });
    });
    expect(harness.posts.slice(-5)).toEqual([
      { type: "platform", cli: "codex" },
      { type: "model", model: "gpt-5-codex" },
      { type: "effort", effort: "xhigh" },
      { type: "ready" },
      { type: "getSettings", requestId: "selection-1" },
    ]);
    expect(store!.state.cli).toBe("codex");
    expect(store!.state.modelByCli.codex).toBe("gpt-5-codex");
    expect(store!.state.effortByCli.codex).toBe("xhigh");
    expect(store!.state.modeByCli.codex).toBe("auto");
    expect(store!.state.log).toEqual([]);

    await act(async () => store!.switchEngine("claude"));
    expect(settings.claude).toEqual({ model: "sonnet", effort: "medium", mode: "acceptEdits" });
    expect(store!.state.modelByCli.codex).toBe("gpt-5-codex");
    expect(store!.state.effortByCli.codex).toBe("xhigh");

    await act(async () => store!.send({ type: "mode", mode: "bypassPermissions" }));
    expect(store!.state.modeByCli.claude).toBe("bypassPermissions");
    expect(readSelectionPreferences(null)).not.toHaveProperty("modeByCli");

    writeSelectionPreferences("wallet-one", { ...DEFAULT_SELECTION_PREFERENCES, modelByCli: { ...DEFAULT_SELECTION_PREFERENCES.modelByCli, claude: "haiku" }, effortByCli: { ...DEFAULT_SELECTION_PREFERENCES.effortByCli, claude: "unsupported" } });
    await act(async () => harness.emit?.({ type: "walletConnected", address: "wallet-one", storageOptions: [] }));
    expect(store!.state.cli).toBe("claude");
    expect(store!.state.modelByCli.claude).toBe("haiku");
    expect(store!.state.effortByCli.claude).toBe("default");
    expect(store!.state.modeByCli.claude).toBe("acceptEdits");
    expect(readSelectionPreferences(null).modelByCli.claude).toBe("sonnet");
    expect(readSelectionPreferences("wallet-one").modelByCli.claude).toBe("haiku");
    expect(readSelectionPreferences("wallet-one").effortByCli.claude).toBe("default");

    await act(async () => store!.send({ type: "mode", mode: "bypassPermissions" }));
    expect(store!.state.modeByCli.claude).toBe("bypassPermissions");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(<StoreProvider><Observer /></StoreProvider>));
    await act(async () => harness.emit?.({ type: "walletConnected", address: "wallet-one", storageOptions: [] }));
    expect(store!.state.modelByCli.claude).toBe("haiku");
    expect(store!.state.modeByCli.claude).toBe("acceptEdits");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it.each([[false, false], [true, false], [false, true]])("retains a saved effort after a failed catalog probe (inactive: %s, recovery before ack: %s)", async (inactive, early) => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  writeSelectionPreferences(null, {
    ...DEFAULT_SELECTION_PREFERENCES,
    modelByCli: { ...DEFAULT_SELECTION_PREFERENCES.modelByCli, claude: "sonnet" },
    effortByCli: { ...DEFAULT_SELECTION_PREFERENCES.effortByCli, claude: "high" },
  });
  let supported = false;
  let cli: Cli = "claude";
  const settings: Record<Cli, { model?: string; effort?: string }> = { claude: {}, codex: {}, custom: {} };
  const snapshot = (requestId?: string, forCli = cli): ServerMessage => ({ type: "settings", cli: forCli, ...settings[forCli], mode: forCli === "claude" ? "acceptEdits" : "auto", requestId });
  harness.onPost = msg => {
    if (msg.type === "platform") cli = msg.cli;
    if (msg.type === "model") settings[cli].model = msg.model;
    if (msg.type === "effort") settings[cli].effort = supported ? msg.effort : undefined;
    if (early && msg.type === "ready" && harness.reopens > 0) {
      supported = true;
      harness.emit?.(catalog(["low", "medium", "high"]));
    }
    if (msg.type === "ready" || msg.type === "platform" || msg.type === "model" || msg.type === "effort") harness.emit?.(snapshot());
    if (msg.type === "getSettings") harness.emit?.(snapshot(msg.requestId));
  };
  let store: ReturnType<typeof useStore> | undefined;
  function Observer() { store = useStore(); return null; }
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const catalog = (supportedEfforts?: string[]): ServerMessage => ({ type: "modelOptions", cli: "claude", options: [{ value: "sonnet", chipLabel: "Sonnet", label: "Sonnet", description: "synthetic catalog", supportedEfforts }] });
  try {
    await act(async () => root.render(<StoreProvider><Observer /></StoreProvider>));
    await act(async () => harness.emit?.({ type: "init", hasWallet: false, defaultPath: null, cloudKind: null }));
    expect(store!.state.effortByCli.claude).toBe(early ? "high" : "default");
    expect(readSelectionPreferences(null).effortByCli.claude).toBe("high");

    if (!early) {
      // A status read and a catalog without capability metadata cannot erase the choice.
      await act(async () => {
        harness.emit?.({ type: "status", status: { cli: "claude", model: settings.claude.model, mode: "acceptEdits" } });
        harness.emit?.(catalog());
      });
      expect(readSelectionPreferences(null).effortByCli.claude).toBe("high");

      await act(async () => harness.emit?.({ type: "cliStatus", claude: "ok", codex: "ok" }));
      if (inactive) await act(async () => store!.switchEngine("codex"));
      supported = true;
      await act(async () => harness.emit?.(catalog(["low", "medium", "high"])));
      if (inactive) {
        await act(async () => harness.emit?.(snapshot(undefined, "claude")));
        expect(readSelectionPreferences(null).effortByCli.claude).toBe("high");
        expect(store!.state.effortByCli.claude).toBe("default");
        await act(async () => store!.switchEngine("claude"));
      }
    }
    expect(harness.posts.slice(-2)).toEqual([{ type: "effort", effort: "high" }, { type: "getSettings", requestId: inactive ? "selection-3" : "selection-2" }]);
    expect(store!.state.effortByCli.claude).toBe("high");
    expect(readSelectionPreferences(null).effortByCli.claude).toBe("high");

    settings.claude.effort = undefined;
    await act(async () => {
      harness.emit?.(catalog(["low"]));
      harness.emit?.(snapshot());
    });
    expect(store!.state.effortByCli.claude).toBe("default");
    expect(readSelectionPreferences(null).effortByCli.claude).toBe("default");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
