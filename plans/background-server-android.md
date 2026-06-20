# Android background server — gated lifecycle (issue #53)

## Before (broken)

```mermaid
flowchart TD
    A["MainActivity.onCreate"] --> B["startForegroundService(ServerService)"]
    B --> C["ServerService — START_STICKY\nongoing notification always on"]
    A --> D["bg thread: install → start node → wait → showWebView"]

    style B fill:#7a2020
    style C fill:#7a2020
```

Problem: foreground service (and its persistent notification) starts on every app launch,
regardless of whether any agent work is happening. `START_STICKY` resurrects it even after
Android kills it. Node/proot runtime stays alive in background permanently.

## After (fix)

```mermaid
flowchart TD
    subgraph Launch
        A["MainActivity.onCreate"] --> D["bg thread: install → start node → wait → showWebView"]
        A --> P["requestPermissions POST_NOTIFICATIONS (Android 13+)"]
    end

    subgraph "Turn lifecycle (web drives, Android responds)"
        W1["state.typing = true\nOR approvals.length > 0"] -->|"syncAgentService(true)"| S1["AgentNetShell.setAgentActive(true)"]
        S1 --> SVC["startForegroundService(ServerService)\nnotif: 'An agent task is running'"]

        W2["typing = false AND approvals empty"] -->|"syncAgentService(false)"| S2["AgentNetShell.setAgentActive(false)"]
        S2 --> STOP["stopService(ServerService)\nAndroid reclaims idle process"]
    end

    subgraph "Approval while backgrounded"
        W3["approvals[0] changes"] -->|"notifyApproval(id, title)"| S3["AgentNetShell.requestApproval(id, title)"]
        S3 --> FG{"inForeground?"}
        FG -->|yes| NOP["WebView shows it — no notification"]
        FG -->|no| NOTIF["NotificationManager.notify()\n'Approval needed · {title}'\ntap → reopen app"]
        NOTIF --> RESUME["onResume → cancel notification\nWebView now shows approval"]
    end

    subgraph "Background exec setting (drawer toggle)"
        TOG["Sessions.tsx toggle"] -->|"setBackgroundExecEnabled(on)"| LS["localStorage key"]
        LS -->|"off, immediately"| S2
        LS -->|"on, next turn"| W1
    end
```

## Key invariants

| Condition | Service state |
|---|---|
| App foreground, no turn | No service (idle process, normal reclaim) |
| App foreground, turn active | No service needed (Activity keeps process alive) |
| App backgrounded, bg exec OFF | No service (process dies, turn dies) |
| App backgrounded, bg exec ON, turn active | Foreground service running |
| App backgrounded, turn ends | `stopService` — service torn down |

## Files changed

| File | Change |
|---|---|
| `surfaces/android/.../MainActivity.kt` | Remove launch-time service start; add `onResume`/`onPause` foreground tracking; add `setAgentActive()` + `requestApproval()`; request POST_NOTIFICATIONS |
| `surfaces/android/.../ServerService.kt` | `START_NOT_STICKY`; updated notification text |
| `surfaces/android/.../ShellBridge.kt` | Expose `setAgentActive` + `requestApproval` to web |
| `surfaces/android/.../AndroidManifest.xml` | Add `POST_NOTIFICATIONS` permission |
| `surfaces/webview/src/platform/agentService.ts` | New: bridge helper + `backgroundExec` localStorage setting |
| `surfaces/webview/src/App.tsx` | `useEffect` drives `syncAgentService` from `typing\|\|approvals`; fires `notifyApproval` on top approval |
| `surfaces/webview/src/chat/Sessions.tsx` | Android-only toggle row in Configure section |

## Deferred (not in this change)

- **Native approve/deny buttons in the notification** — needs a native→`/rpc` callback round-trip. Add when tap-to-open proves insufficient.
- **Approval timeout** — unblocking the runtime after deny/timeout lives in `ApprovalChannel` (core), not Android shell.
