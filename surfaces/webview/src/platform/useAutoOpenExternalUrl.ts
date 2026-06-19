import { useEffect, useRef } from "react";
import { openExternalUrl } from "./openExternalUrl";

export function useAutoOpenExternalUrl(url: string | null): void {
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!url || opened.current === url) return;
    opened.current = url;
    openExternalUrl(url);
  }, [url]);
}
