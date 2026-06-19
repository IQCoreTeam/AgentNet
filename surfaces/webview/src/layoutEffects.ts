import { useEffect } from "react";

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
