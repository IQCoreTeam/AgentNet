import { afterEach, expect, it, vi } from "vitest";
import { openExternalUrl } from "./openExternalUrl";

afterEach(() => vi.unstubAllGlobals());

it("opens one browser tab and clears its opener before navigating", () => {
  const link = { href: "", rel: "", click: vi.fn(() => expect(tab.opener).toBeNull()) };
  const document = { createElement: vi.fn(() => link) };
  const tab = { document, opener: {} as unknown };
  const open = vi.fn(() => tab), assign = vi.fn();
  vi.stubGlobal("window", { open, location: { assign } });
  openExternalUrl("https://accounts.google.com/example");
  expect(open).toHaveBeenCalledExactlyOnceWith("about:blank", "_blank");
  expect(link.href).toBe("https://accounts.google.com/example");
  expect(link.rel).toBe("noreferrer");
  expect(link.click).toHaveBeenCalledOnce();
  expect(assign).not.toHaveBeenCalled();
});

it("uses same-tab navigation when a popup is blocked", () => {
  const assign = vi.fn();
  vi.stubGlobal("window", { open: vi.fn(() => null), location: { assign } });
  openExternalUrl("https://accounts.google.com/example");
  expect(assign).toHaveBeenCalledExactlyOnceWith("https://accounts.google.com/example");
});

it("delegates to the native Android bridge without browser navigation", () => {
  const openUrl = vi.fn(), open = vi.fn(), assign = vi.fn();
  vi.stubGlobal("window", { AgentNetShell: { openUrl }, open, location: { assign } });
  openExternalUrl("https://accounts.google.com/example");
  expect(openUrl).toHaveBeenCalledExactlyOnceWith("https://accounts.google.com/example");
  expect(open).not.toHaveBeenCalled();
  expect(assign).not.toHaveBeenCalled();
});
