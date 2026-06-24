// No blocking engine picker. After wallet connect we route straight to an engine and let
// its own gate handle login: both ready -> Claude; only one ready -> that one; none ready
// -> Claude (its auth screen IS the login, so there's no choice to block on). Users switch
// engines later from the composer's engine toggle. Shows the shared Splash while routing so
// it reads as one continuous start-up, not a separate screen.

import { useEffect } from "react";
import { Splash } from "./Splash";
import { useStore } from "../state/store";

export function PickEngine() {
  const { state, selectEngine } = useStore();
  const report = state.cliReport;

  useEffect(() => {
    if (report) {
      selectEngine(report.codex === "ok" && report.claude !== "ok" ? "codex" : "claude");
      return;
    }
    // CLI report not in yet: default to Claude shortly so we never hang on this screen.
    const t = setTimeout(() => selectEngine("claude"), 700);
    return () => clearTimeout(t);
  }, [report]);

  return <Splash />;
}
