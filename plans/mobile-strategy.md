# AgentNet Mobile Strategy — Research Notes

Findings from researching how to run a claude/codex agent on a phone WITHOUT a server.
Facts gathered before any coding. (As of 2026-06. Anthropic policy is in flux, so dates
are stamped.)

## TL;DR

- **It's not blocked because the phone CPU is slow.** Node.js runs at **native ARM speed**
  on a phone.
- The one real wall: **using `child_process.spawn` to launch the claude/codex binary** —
  unsupported by nodejs-mobile + the iOS OS blocks it outright.
- The cost crux: **running the claude SDK whole = authenticates with the user's
  subscription = cheap.** **Calling the API directly = pay-per-token = 15–30× more expensive.**
- **Decision: mobile = Android only, iOS unsupported (for now).**
  - **Android** = proot-distro runs claude whole, native ARM, subscription, self-contained. The main target.
  - **iOS** = shelved because Apple blocks fork/process-creation at the kernel level. Not a
    phone-performance issue (reasons below).

## What works / doesn't on a phone (verified facts)

| Layer | On a phone? | Basis |
|---|---|---|
| Node.js JS execution | ✅ **native ARM** | nodejs-mobile (JaneaSystems) — iOS/Android arm64, not emulation |
| Our runtime JS logic (canonical/encryption/inject) | ✅ | runs as-is on the Node above |
| LLM API direct calls (HTTPS) | ✅ | just networking |
| Native modules (C/C++/Rust, cross-compiled) | ✅ | nodejs-mobile supports native modules |
| **`child_process.spawn` (running a binary)** | ❌ | unsupported by nodejs-mobile [issue #25] + **iOS sandbox forbids fork** ("Operation not permitted") |

Key: what the claude binary does = `[LLM API call] + [tool execution] + [agent loop]`.
Everything inside it needs no spawn (pure Node API), so it works on a phone. spawn is only
needed to "run the claude binary whole."

## The decisive platform difference

### Android — can run claude whole (native ARM)
- **proot-distro** (termux): runs full Ubuntu/Debian Linux at **native ARM speed**. No
  QEMU/hypervisor (not emulation). No root required.
- node + claude code actually run inside it (proven by claude-code-termux et al.).
- If we bundle proot-distro into our app, it's automatic — the user doesn't hand-set up Termux.

### iOS — subprocesses forbidden at the OS level
- iOS apps **cannot** use `fork()`/`popen()`/child_process (Apple sandbox, no workaround
  short of jailbreak).
- iSH (x86 emulation) = slow + modern node crashes. a-Shell = only partly ARM. → local full
  execution is impractical.
- nodejs-mobile runs **JS natively but spawn doesn't work.**
- New hope: ios-linuxkit / iSH-arm64 ("Asbestos") = ARM translation + can pass App Store
  review, but only "shell-grade" speed.

## Auth & cost (★ the crux that splits the mobile strategy)

- Subscription (Pro/Max) ≠ API. **Direct API calls are billed separately, pay-per-token,
  15–30× more than the subscription.**
- Extracting the subscription OAuth token to reuse it = **blocked and a ToS violation**
  (third-party harnesses cut off 2026-04-04).
- ⭐ **From 2026-06-15: third-party apps authenticating the Agent SDK with the user's claude
  subscription is officially allowed** (a separate monthly Agent SDK credit). → running the
  claude SDK whole means **cheap, via the user's subscription.**

| Approach | Auth | Cost |
|---|---|---|
| Run claude SDK whole (A) | user subscription OAuth | cheap (subscription credit) |
| Direct API calls (B) | API key | expensive (pay-per-token, 15–30×) |

## Chosen approach: Plan A (Android)

**A. Bundle proot-distro** — the app auto-provisions native ARM Linux (Ubuntu) + node +
claude on Android. Runs the claude binary whole → authenticates with the user's
subscription (cheap) → phone self-contained. Zero server.

Shelved / not chosen:
- **iOS** = OS forbids fork → can't launch claude → unsupported (see "Why we gave up on iOS").
- "My PC runs claude, phone is a remote" (remote/PC-direct) = doesn't fit the phone-self-
  contained goal, shelved.
- "Direct API calls" (B) = can't use the subscription and is expensive pay-per-token → with
  Plan A available on Android, unnecessary.

## Decision (2026-06)

- **Android = supported.** Plan A (proot-distro runs claude whole, native ARM, subscription,
  self-contained). The main mobile target.
- **iOS = not supported (for now).** Not a tech shortfall — it's **Apple's OS lockdown**. See
  "Why we gave up on iOS." The phone CPU is plenty fast (native Node works) and file ops work,
  but the core of a coding agent — "running external commands (bash/build/test)" — is blocked
  by the kernel, so going self-contained would mean essentially rebuilding claude code whole
  (no subscription · build the tool environment ourselves · re-implement the agent), which
  isn't worth the weight.

## Why we gave up on iOS (summary)

One line: **it's not a phone-performance problem — Apple blocks "creating a new process
(fork/exec)" at the kernel/hardware level.** CPU, memory, filesystem are all sufficient, but
"running claude (or the bash that claude uses) as a separate process" on top of them is
impossible at the OS level.

The chain of blockers:
1. iOS blocks fork/posix_spawn at the kernel ("Operation not permitted"). Not policy but
   kernel/hardware (a 4-fold lock: W^X + code signing + sandbox + entitlements). App code
   can't break through it (short of jailbreak).
2. → can't launch the claude binary on the phone. "Convert it for iOS" is also impossible
   (closed source → can't recompile + no signature → can't run).
3. → to work around it you'd "not use claude and reproduce what claude does," but then:
   - **can't use the subscription** → pay-per-token API (15–30× more).
   - **can't fork for bash/tools either**, so like a-Shell you'd have to build the whole thing
     yourself — compiling every command (node/git/rg…) as an iOS library callable as a
     function (a huge effort).
   - you'd also have to reproduce claude code's agent smarts.
   = essentially a project to rebuild claude code whole. Not worth the weight → shelved.

> The frustrating part: it's blocked not because "the phone is slow" but purely because of
> Apple's lockdown. Android, with the same ARM CPU, runs real Linux at native speed via proot
> and claude works as-is. Only iOS hits the policy wall. Revisit if Apple loosens the policy
> (unlikely) or workaround tech matures.

For the detailed mechanism see the sections below: "iOS spawn block mechanism" / "Where
claude uses child_process" / "The two pieces of the iOS workaround" / "★ The core
constraint" (analysis kept on record).

## iOS spawn block mechanism (why it's blocked — kernel, not policy)

iOS isn't "blocking because Apple dislikes it" — it's a 4-fold kernel/hardware lock that app
code can't break:
1. **Process isolation** — the app is designed to see itself as "the only process running."
   The kernel blocks creating a child at all.
2. **W^X + code signing (★core)** — writable memory can't be executable (`mprotect` modified
   in the kernel) + only Apple-signed code runs. The claude binary is unsigned, so even if a
   fork happens, the kernel kills it the moment it tries to execute.
3. **Entitlement lock** — "what an app can do" is baked in via Apple's signature, immutable.
   No public entitlement grants spawn rights.
4. **No public API** — calling `posix_spawn`/`fork` returns "Operation not permitted."

Workaround directions to investigate (not yet verified):
- Sideloading + JIT (AltStore etc.) — off the App Store, re-sign every 7 days, high barrier
  for ordinary users.
- iSH-arm64 "Asbestos" threaded interpreter — ARM translation without code generation, can
  pass App Store review but slow.
- In-process linking (dlopen) — run in the same process without spawn. Hard because claude is
  closed source.
- WASM — compiling claude to WASM would let it run in a signed runtime (Anthropic won't do it).
- Jailbreak — breaks the kernel protections. Can't ship to the public.

## Where claude uses child_process (spawn) — two layers

1. **Layer 1 — the SDK spawns the claude binary itself** (`pathToClaudeCodeExecutable`).
   If we skip the SDK and call the LLM API directly, this layer disappears.
2. **Layer 2 — when claude executes tools** (the heart of claude code). The Bash tool =
   `spawn("bash",…)`, Grep = `spawn("rg",…)`, git/npm, etc. **This is the real wall** — the
   agent's "hands and feet."

Works / doesn't on a phone:
| What claude does | spawn? | On a phone |
|---|---|---|
| LLM call (the brain) | ❌ | ✅ API |
| File Read/Write/Edit (hands) | ❌ (Node fs) | ✅ |
| **Bash/search (running external commands)** | ✅ | ❌ blocked on iOS |

→ On a phone, "reading code + chatting with the LLM + editing files" all work, but
**"building/testing/running via bash" is blocked.**

## The two pieces of the iOS workaround (both needed to make it work)

### Piece 1 — the path-illusion wrapper (zo's idea, ✅ works)
- An iOS app can freely read/write only `~/Documents`, `~/Library`, `~/tmp`.
- a-Shell already does this: it swaps env vars like `$HOME`,`$PWD` to point at `~/Documents`
  → programs running inside it think "this is home." `cd ~`, `git clone`, file trees all work.
- If we make `Documents/AgentNet` the illusory home/project root, **file work works fully.**
- But this only solves the "path" problem. "Process creation (fork)" is a separate layer this
  doesn't solve.

### Piece 2 — running commands as functions instead of processes (a-Shell / ios_system, ✅ works)
- Since iOS blocks fork, instead of `fork+exec("ls")` the shell **compiles the command's
  source into the app as a library** and calls `ls_main()` **as a function on a thread**
  (rewriting main→pthread_exit, etc.).
- That's how a-Shell runs python/node/grep on a phone — no separate process, inside the signed app.
- **Limit: only commands compiled into the app ahead of time (= open source) work.**

## ★ The core constraint: the claude binary can't go on the phone (can't be converted)

- "Convert the claude binary for iOS and put it in the wrapper" is impossible on two counts:
  1. **Conversion needs source. claude is closed source** — only the built binary is public.
     Can't recompile. (You got the baked bread but no recipe, so you can't re-bake it for
     another oven.)
  2. Even if you made one, **no Apple signature → the kernel kills it on execution.**
- node/python/git can go on the phone via a-Shell **because they're open source and could be
  recompiled from source.** claude can't.

## So the real shape of iOS self-containment: "put claude in" → "reproduce what claude does"

The claude binary = really `[LLM API call] + [tool execution] + [the loop tying them]`. The
smarts aren't in the binary but in **Anthropic's server LLM (the API)**. So what goes on the
phone isn't the binary, but:
- **API/subscription** (borrow the smarts) +
- **open-source tools** (node/git etc. linked the a-Shell way = Piece 2) +
- **`Documents/AgentNet` home illusion** (= Piece 1) +
- **a thin agent loop we write** (LLM↔tool wiring, replacing the claude binary).

These four would, in theory, give a phone-self-contained agent on iOS with no server, no fork,
no binary. But the weight: **it amounts to nearly rebuilding an a-Shell-grade terminal
environment ourselves** → forking a-Shell (open source) is more realistic. The crux is how
much of claude code's agent smarts (system prompts, tool design, strategy) we reproduce.

> Android = claude **as-is** (proot). iOS = a **claude-like thing we build**. That's why the
> two diverge.

## Reusable assets we already have
- The core (`src/`) is vscode-agnostic = platform-neutral. Mobile/CLI/web import it as-is.
- The `runtime` engine = the engine for Plan A (runs inside proot Linux).
- The `ApprovalChannel` abstraction = "approvals in any form" → new forms like phone-push
  approval attach naturally.
- The `Wallet`/`StorageAdapter` interfaces = the phone implements them its own way (wallet
  signing / session encryption).
- The webview UI (command-thread / approval dock / skills / md) = a React Native porting target.

## Open-source references (researched)
- **nodejs-mobile** (JaneaSystems) — native Node on phones, has an RN plugin.
- **proot-distro** (termux) — native ARM Linux on Android (core of Plan A).
- **claude-code-termux** (eduterre et al.) — runs claude via proot on Android (proves Plan A).
- (reference only, not our path) **MobileCLI / Happy Coder** — PC runs claude, phone is a
  remote. We aim for phone self-containment, so this PC-direct approach is shelved; only the
  protocol structure is worth referencing.

## Unverified / next research
- **iOS self-containment workarounds** — whether any of the "directions to investigate" above
  actually work (sideload JIT / Asbestos / dlopen / WASM).
- Whether any open-source PoC runs an LLM agent loop (tool calls) on top of nodejs-mobile
  (skeleton for Plan B).
- Cases of bundling proot-distro into an app with "no manual user setup" (Plan A UX).
- Exact limits/terms of the 2026-06-15 Agent SDK subscription credit (to confirm Plan A cost).
