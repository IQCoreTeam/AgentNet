import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { ConnectDriveForm } from "./settings/ConnectDriveForm";
import { initialState } from "./state/store";
import { LangProvider } from "./i18n";
import { openExternalUrl } from "./platform/openExternalUrl";

const store = vi.hoisted(() => ({ state: {} as any, send: vi.fn(), getClientId: () => "qa", closeMarket: vi.fn() }));
vi.mock("./state/store", async importOriginal => ({ ...await importOriginal<typeof import("./state/store")>(), useStore: () => store }));
vi.mock("./platform/openExternalUrl", () => ({ openExternalUrl: vi.fn() }));
vi.mock("./unlock/WelcomeTutorial", () => ({ WelcomeTutorial: () => null }));
vi.mock("./unlock/StarterTemplates", () => ({ StarterTemplates: () => null }));
vi.mock("./layoutEffects", () => ({ useVisualViewportVars: () => {}, useKeyboardChrome: () => {}, useIsDesktop: () => true, useOnline: () => true }));
vi.mock("./unlock/UnlockProvider", () => ({ useUnlock: () => ({ requestUnlock: vi.fn() }), LockedGate: () => null, LinkRow: () => null }));

afterEach(() => vi.clearAllMocks());
it("opens once across mounted Drive UI, settings remounts and StrictMode, but permits a new attempt", async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  store.state = { ...initialState, googleLoginUrl: "https://accounts.google.com/qa?state=one" };
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = () => act(async () => root.render(<StrictMode><LangProvider><App /><ConnectDriveForm /></LangProvider></StrictMode>));
  try {
    await render();
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    // Sessions mounts for engine settings and unmounts on leaving that screen.
    store.state = { ...store.state, phase: "customAuth" };
    await render();
    store.state = { ...store.state, phase: "connecting" };
    await render();
    store.state = { ...store.state, phase: "customAuth" };
    await render();
    expect(openExternalUrl).toHaveBeenCalledTimes(1);
    store.state = { ...store.state, googleLoginUrl: null };
    await render();
    store.state = { ...store.state, googleLoginUrl: "https://accounts.google.com/qa?state=two" };
    await render();
    expect(openExternalUrl).toHaveBeenCalledTimes(2);
    expect(openExternalUrl).toHaveBeenLastCalledWith(store.state.googleLoginUrl);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
