import { useEffect } from "react";
import { useStore } from "./state/store";

// Transient bottom toast for `toast` events (wallet errors, etc.). Auto-dismisses.
export function Toast() {
  const { state, clearToast } = useStore();
  useEffect(() => {
    if (!state.toast) return;
    const id = setTimeout(clearToast, 3000);
    return () => clearTimeout(id);
  }, [state.toast, clearToast]);

  if (!state.toast) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-4"
      style={{
        bottom: "calc(var(--composer-height, 0px) + var(--approval-dock-height, 0px) + max(0.75rem, env(safe-area-inset-bottom)))",
      }}
    >
      <div className="rounded-lg bg-zinc-800 px-4 py-2 text-sm text-zinc-100 shadow-lg">
        {state.toast}
      </div>
    </div>
  );
}
