import { useEffect, useState } from "react";

// Tracks device connectivity (navigator.onLine + online/offline events) so screens can
// show a calm offline state instead of an endless spinner when there's no network.
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

export function useVisualViewportVars() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;

    const write = () => {
      frame = 0;
      const viewport = window.visualViewport;
      const height = Math.round(viewport?.height ?? window.innerHeight);
      const offsetTop = Math.round(viewport?.offsetTop ?? 0);
      const keyboardInset = Math.max(0, Math.round(window.innerHeight - height - offsetTop));

      root.style.setProperty("--vvh", `${height}px`);
      root.style.setProperty("--keyboard-inset-bottom", `${keyboardInset}px`);
    };

    const schedule = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(write);
    };

    schedule();
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
    };
  }, []);
}

// Flag the on-screen keyboard so chrome (the bottom tab bar) hides while typing and
// returns when the field blurs. We can't rely on a visualViewport height delta: this
// Android WebView uses adjustResize, so the window itself shrinks above the keyboard and
// the delta stays ~0. Tracking focus of an editable element is the reliable signal.
export function useKeyboardChrome() {
  useEffect(() => {
    const root = document.documentElement;
    const isEditable = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      if (el instanceof HTMLTextAreaElement) return true;
      if (el instanceof HTMLInputElement) {
        return !["button", "checkbox", "radio", "file", "submit", "reset", "range", "color"].includes(el.type);
      }
      return false;
    };
    const sync = () => {
      if (isEditable(document.activeElement)) root.setAttribute("data-keyboard", "open");
      else root.removeAttribute("data-keyboard");
    };
    document.addEventListener("focusin", sync);
    document.addEventListener("focusout", sync);
    sync();
    return () => {
      document.removeEventListener("focusin", sync);
      document.removeEventListener("focusout", sync);
      root.removeAttribute("data-keyboard");
    };
  }, []);
}

export function useElementHeightVariable(ref: { current: HTMLElement | null }, variableName: string) {
  useEffect(() => {
    const root = document.documentElement;

    const write = () => {
      root.style.setProperty(variableName, `${Math.ceil(ref.current?.getBoundingClientRect().height ?? 0)}px`);
    };

    write();
    window.addEventListener("resize", write);

    if (typeof ResizeObserver === "undefined" || !ref.current) {
      return () => {
        window.removeEventListener("resize", write);
        root.style.setProperty(variableName, "0px");
      };
    }

    const observer = new ResizeObserver(write);
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", write);
      root.style.setProperty(variableName, "0px");
    };
  }, [ref, variableName]);
}
