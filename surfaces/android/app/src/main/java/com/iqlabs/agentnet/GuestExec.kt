package com.iqlabs.agentnet

// The single seam through which the proot guest is launched. A strategy owns HOW guest
// binaries are exec'd; the caller (ServerManager) expresses only WHAT to run — a guest
// command plus the guest process environment — and never learns which strategy is active.
//
// Today there is exactly one strategy, DirectProotExec, which runs the stock proot launch
// and therefore needs the targetSdk<=28 W^X exemption to exec the guest's binaries out of
// app storage. Module 3 (plans/raise-targetsdk-exec.md) adds a linker-routing strategy for
// targetSdk>=29; when it exists the selection point in ServerManager gains a second case.
interface GuestExec {
    // Launch `guestCommand` inside the guest via its login shell, with `guestEnv` as the
    // guest process environment ("KEY=VALUE" entries). Returns a live host Process with
    // stdout and stderr merged. The caller owns lifecycle (log draining, stop); the strategy
    // owns guest entry and all host-side mechanics.
    fun launch(guestEnv: List<String>, guestCommand: String): Process
}
