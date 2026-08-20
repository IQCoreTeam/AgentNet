# AgentNet Desktop

A native desktop app (macOS, Windows, Linux) for AgentNet, built with Tauri.

It is a thin native shell around the existing `localhost` surface: on launch it
spawns `surfaces/localhost/dist/index.js` (the same server that serves the built
webview SPA plus the `/events` SSE and `/rpc` transport), waits for the port,
and opens a native window pointed at `http://localhost:4317`. The SPA runs
same-origin exactly as it does in a browser. None of the core, webview, or
localhost code is modified; the desktop shell only wraps them.

---

## What it adds

- **System tray** (macOS menu bar / Windows and Linux tray) with Open, Hide,
  and Quit, plus click-to-toggle the window.
- **Runs in the background**: closing the window hides it to the tray and keeps
  the server alive; only Quit exits, and it stops the spawned server.
- **IQLabs icon** for the window, dock, and tray.

## Run it (development)

Needs Rust, Node, and the two surfaces it wraps built first:

```sh
pnpm --filter agentnet-webview build
pnpm --filter agentnet-localhost build
cargo run --manifest-path surfaces/desktop/src-tauri/Cargo.toml
```

In development the shell resolves the server from the repo checkout, so a clone
just works with no configured paths. Overrides: `AGENTNET_SERVER_JS`,
`AGENTNET_NODE_BIN`.

## Build a self-contained app

```sh
cd surfaces/desktop
./build-app.sh
```

`stage-resources.sh` downloads a portable Node runtime (the official nodejs.org
build, which links only system libraries) and stages the built server and
webview into `bundle-resources/`; `build-app.sh` then runs `tauri build` to
produce `src-tauri/target/release/bundle/macos/AgentNet.app`. Everything the app
needs lives inside `Contents/Resources`, so the `.app` runs with no repo
checkout and no system Node. The staging inputs are gitignored (binary blobs);
the scripts are the committed source of truth.

## Distribution is out of scope here

Code signing, notarization, and a release pipeline (the equivalent of the
Android surface's own release workflow) are deliberately not part of this shell.
They need the project's signing identities and release infrastructure, so they
belong wherever those live.
