// NotifyingApprovalChannel — a native desktop-popup layer over any ApprovalChannel.
//
// Goal: when an approval/question arrives while the VS Code window is NOT focused (the user is
// off doing something else), pop a native OS dialog so they can answer without hunting for the
// window. The in-app webview card stays the source of truth: come back to VS Code and the card
// is right there. Whoever answers first wins — the other surface is torn down (single
// resolution, no double-send).
//
// Cross-platform, dependency-light: each OS uses tools already on the machine —
//   macOS   -> osascript            (always present)
//   Linux   -> zenity, else kdialog (detected; neither -> no popup, webview only)
//   Windows -> PowerShell + WinForms (always present)
// The TIERING (what widget for which request) lives in showPopup once; each OS only implements
// primitives via the Prompter seam (askMain / askReason / askChoice / route).
//
// Sync (see approvalChannel.ts for the protocol): the webview answers by posting
// {type:"approvalDecision", id, ...}; TransportApprovalChannel resolves the parked promise for
// that id (dupes guarded). So when the POPUP is answered we INJECT that same message — the
// channel resolves exactly as if the webview had been clicked — then send {type:"approvalDismiss",
// id} so the webview clears its now-stale card. If the webview answers first, or focus returns,
// we abort the modal.

import * as vscode from "vscode";
import { execFile } from "node:child_process";
import type {
  ApprovalChannel,
  ApprovalRequest,
  ApprovalDecision,
} from "@iqlabs-official/agent-sdk/runtime/approval/channel";

// The slice of the transport we need: send to the webview, and inject a message into the
// channel's onRecv fan-out (added on the VS Code transport in extension.ts).
export interface NotifyTransport {
  send: (msg: unknown) => void;
  inject: (msg: any) => void;
}

const SENTINEL = "Write my own answer…"; // the "custom input" row in a pick list

// ── low-level: run a tool, never reject. Resolves exit code + stdout/stderr; flags a missing
// binary (ENOENT) so Linux can fall back zenity -> kdialog -> none. An aborted run (focus came
// back / webview answered) lands here too, as a non-zero code we treat as "no decision".
interface RunResult { code: number; stdout: string; stderr: string; ok: boolean; missing: boolean }
function run(cmd: string, args: string[], signal: AbortSignal): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cmd, args, { signal, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      const out = String(stdout || "");
      const errOut = String(stderr || "");
      if (err) {
        const e = err as NodeJS.ErrnoException & { code?: number | string };
        const missing = e.code === "ENOENT";
        const code = typeof e.code === "number" ? e.code : missing ? 127 : 1;
        resolve({ code, stdout: out, stderr: errOut, ok: false, missing });
      } else {
        resolve({ code: 0, stdout: out, stderr: errOut, ok: true, missing: false });
      }
    });
  });
}

function trunc(s: string, n: number): string {
  s = String(s ?? "");
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// One-line body for a tool approval (bash/edit/write/read/plan/other).
function toolBody(req: ApprovalRequest): string {
  const lines: string[] = [req.title || req.tool || "Approve this action?"];
  if (req.cwd) lines.push("cwd: " + req.cwd);
  if (req.command) lines.push("\n$ " + trunc(req.command, 500));
  else if (req.diff) lines.push("\n" + trunc(req.diff, 600));
  else if (req.file) lines.push("\n" + req.file);
  return lines.join("\n");
}

// ── the OS seam. Each returns null when the user cancelled/closed (or the run was aborted) —
// meaning "no decision", so the webview card remains the way to answer.
// A tool approval is TWO steps so it mirrors the webview card exactly: askMain shows
// [Approve] [Always] [Deny]; on Deny, askReason shows an input whose Cancel goes BACK to the
// buttons ({back:true}). showPopup drives the loop, so the back-navigation is identical on
// every OS.
type MainChoice = "once" | "always" | "deny" | null;
type ReasonChoice = { back: true } | { reason?: string } | null;
interface Prompter {
  askMain(o: { title: string; body: string; danger: boolean }, signal: AbortSignal): Promise<MainChoice>;
  askReason(o: { title: string }, signal: AbortSignal): Promise<ReasonChoice>;
  askChoice(
    o: { question: string; header?: string; options: { label: string; description?: string }[]; multi: boolean; allowCustom: boolean },
    signal: AbortSignal,
  ): Promise<{ selected: string[]; text?: string } | null>;
  route(o: { appName: string; message: string }, signal: AbortSignal): Promise<void>;
}

// ─────────────────────────── macOS: osascript ───────────────────────────
// AppleScript string escaping: backslash, quote, then newlines -> `linefeed` concatenation.
function macEsc(s: string): string {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '" & linefeed & "');
}
// Parse `display dialog` output: "button returned:X[, text returned:Y]" (Y may contain commas).
function parseDialog(out: string): { button: string; text: string } {
  const m = out.match(/^button returned:([\s\S]*?)(?:, text returned:([\s\S]*))?$/);
  if (!m) return { button: out.replace(/^button returned:/, ""), text: "" };
  return { button: m[1] ?? "", text: m[2] ?? "" };
}
const osa = (script: string, signal: AbortSignal) => run("osascript", ["-e", script], signal);

const macPrompter: Prompter = {
  async askMain({ title, body, danger }, signal) {
    // No text field here — the input only appears after Deny (askReason). No "Cancel" button,
    // so Esc can't dismiss it; only a real teardown (focus back) aborts -> code !== 0.
    // Approve is always the blue default button (Enter = approve); danger requests still get
    // the caution icon so they read as risky without making Deny the confusing highlighted one.
    const r = await osa(
      `display dialog "${macEsc(body + "\n\n↩  Press [Enter] to approve")}" with title "${macEsc(title)}" buttons {"Deny", "Always", "Approve"} default button "Approve"${danger ? " with icon caution" : ""}`,
      signal,
    );
    if (r.code !== 0) return null;
    const b = parseDialog(r.stdout.trim()).button;
    return b === "Approve" ? "once" : b === "Always" ? "always" : "deny";
  },
  async askReason({ title }, signal) {
    // A button literally named "Cancel" makes AppleScript raise -128 (user cancelled) on click,
    // surfacing as code !== 0. We read that as "go back" — unless the signal actually aborted
    // (focus returned / the webview answered), which means tear down instead.
    const r = await osa(
      `display dialog "Deny reason (sent to the agent, optional):" with title "${macEsc(title)}" default answer "" buttons {"Cancel", "Deny"} default button "Deny"`,
      signal,
    );
    if (signal.aborted) return null;
    if (r.code !== 0) return { back: true };
    return { reason: parseDialog(r.stdout.trim()).text.trim() || undefined };
  },
  async askChoice({ question, header, options, multi, allowCustom }, signal) {
    const simple = options.length > 0 && options.length <= 3 && !multi;
    if (simple && !allowCustom) {
      const body = question + "\n\n" + options.map((o) => "• " + o.label + (o.description ? " — " + o.description : "")).join("\n");
      const buttons = options.map((o) => `"${macEsc(o.label)}"`).join(", ");
      const r = await osa(
        `display dialog "${macEsc(body)}" with title "${macEsc(header || "AgentNet")}" buttons {${buttons}} default button "${macEsc(options[options.length - 1].label)}"`,
        signal,
      );
      if (r.code !== 0) return null;
      return { selected: [parseDialog(r.stdout.trim()).button] };
    }
    if (simple && allowCustom) {
      const body = question + "\n\n" + options.map((o) => "• " + o.label).join("\n") + "\n\n(Or type your own answer below.)";
      const buttons = options.map((o) => `"${macEsc(o.label)}"`).join(", ");
      const r = await osa(
        `display dialog "${macEsc(body)}" with title "${macEsc(header || "AgentNet")}" default answer "" buttons {${buttons}} default button "${macEsc(options[options.length - 1].label)}"`,
        signal,
      );
      if (r.code !== 0) return null;
      const { button, text } = parseDialog(r.stdout.trim());
      const typed = text.trim();
      return typed ? { selected: [], text: typed } : { selected: [button] };
    }
    // >3 options or multiSelect: a pick list, with a sentinel row for custom input.
    const items = options.map((o) => `"${macEsc(o.label)}"`);
    if (allowCustom) items.push(`"${macEsc(SENTINEL)}"`);
    const multiClause = multi ? " with multiple selections allowed" : "";
    const r = await osa(
      `choose from list {${items.join(", ")}} with title "AgentNet" with prompt "${macEsc(question)}"${multiClause}`,
      signal,
    );
    const out = r.stdout.trim();
    if (r.code !== 0 || out === "false" || out === "") return null;
    let selected = out.split(", ");
    let text: string | undefined;
    if (allowCustom && selected.indexOf(SENTINEL) >= 0) {
      selected = selected.filter((s) => s !== SENTINEL);
      const t = await osa(`display dialog "${macEsc(question)}" with title "AgentNet" default answer "" buttons {"Cancel", "OK"} default button "OK"`, signal);
      if (t.code === 0) text = parseDialog(t.stdout.trim()).text.trim() || undefined;
    }
    return { selected, ...(text ? { text } : {}) };
  },
  async route({ appName, message }, signal) {
    await osa(`display dialog "${macEsc(message)}" with title "AgentNet" buttons {"Open in ${macEsc(appName)}"} default button "Open in ${macEsc(appName)}"`, signal);
    await osa(`tell application "${macEsc(appName)}" to activate`, signal);
  },
};

// ─────────────────────────── Linux: zenity ───────────────────────────
// execFile passes args as literal argv (no shell), so option labels need no escaping. zenity's
// exit codes carry the answer: 0 = OK/primary; 1 = Cancel/closed OR an --extra-button (whose
// label prints to stdout); so OK vs extra-button vs closed are all distinguishable.
const SEP = "\x1f"; // unit separator — a list value is very unlikely to contain it
const zenityPrompter: Prompter = {
  async askMain({ title, body, danger }, signal) {
    const r = await run(
      "zenity",
      ["--question", "--title", title, "--text", body + "\n\n↩  Press [Enter] to approve", "--ok-label=Approve", "--extra-button=Always", "--extra-button=Deny", ...(danger ? ["--icon-name=dialog-warning"] : [])],
      signal,
    );
    if (r.code === 0) return "once"; // OK = Approve
    const out = r.stdout.trim();
    if (out === "Always") return "always";
    if (out === "Deny") return "deny";
    return null; // window closed / abort
  },
  async askReason({ title: _title }, signal) {
    const e = await run("zenity", ["--entry", "--title", "Deny", "--text", "Message for the agent (optional):"], signal);
    if (e.code === 0) return { reason: e.stdout.trim() || undefined };
    return signal.aborted ? null : { back: true }; // Cancel on the entry = back to the buttons
  },
  async askChoice({ question, header, options, multi, allowCustom }, signal) {
    const rows: string[] = [];
    for (const o of options) rows.push("FALSE", o.label);
    if (allowCustom) rows.push("FALSE", SENTINEL);
    const r = await run(
      "zenity",
      [
        "--list",
        multi ? "--checklist" : "--radiolist",
        "--title", header || "AgentNet",
        "--text", question,
        "--column", "", "--column", "Option",
        "--print-column=2",
        `--separator=${SEP}`,
        ...rows,
      ],
      signal,
    );
    if (r.code !== 0) return null;
    let selected = r.stdout.trim().split(SEP).filter(Boolean);
    if (!selected.length) return null;
    let text: string | undefined;
    if (allowCustom && selected.indexOf(SENTINEL) >= 0) {
      selected = selected.filter((s) => s !== SENTINEL);
      const e = await run("zenity", ["--entry", "--title", "AgentNet", "--text", question], signal);
      if (e.code === 0) text = e.stdout.trim() || undefined;
    }
    return { selected, ...(text ? { text } : {}) };
  },
  async route({ appName, message }, signal) {
    await run("zenity", ["--info", "--title", "AgentNet", "--text", message + "\n\nOpen " + appName + " to answer."], signal);
  },
};

// ─────────────────────────── Linux: kdialog (fallback) ───────────────────────────
const kdialogPrompter: Prompter = {
  // kdialog can't safely carry three custom buttons (a window-close maps to Cancel, which would
  // read as an accidental "always"), so this fallback stays Approve / Deny. Yes = Approve;
  // No or a closed window = Deny (the safe default).
  async askMain({ title, body }, signal) {
    const r = await run("kdialog", ["--title", title, "--warningyesno", body + "\n\n↩  Press [Enter] to approve"], signal);
    if (r.code === 0) return "once";
    return signal.aborted ? null : "deny";
  },
  async askReason({ title: _title }, signal) {
    const e = await run("kdialog", ["--title", "Deny", "--inputbox", "Message for the agent (optional):"], signal);
    if (e.code === 0) return { reason: e.stdout.trim() || undefined };
    return signal.aborted ? null : { back: true };
  },
  async askChoice({ question, header, options, multi, allowCustom }, signal) {
    const rows: string[] = [];
    for (const o of options) rows.push(o.label, o.label, "off"); // tag == label
    if (allowCustom) rows.push(SENTINEL, SENTINEL, "off");
    const r = await run(
      "kdialog",
      ["--title", header || "AgentNet", "--separate-output", multi ? "--checklist" : "--radiolist", question, ...rows],
      signal,
    );
    if (r.code !== 0) return null;
    let selected = r.stdout.trim().split("\n").filter(Boolean);
    if (!selected.length) return null;
    let text: string | undefined;
    if (allowCustom && selected.indexOf(SENTINEL) >= 0) {
      selected = selected.filter((s) => s !== SENTINEL);
      const e = await run("kdialog", ["--title", "AgentNet", "--inputbox", question], signal);
      if (e.code === 0) text = e.stdout.trim() || undefined;
    }
    return { selected, ...(text ? { text } : {}) };
  },
  async route({ appName, message }, signal) {
    await run("kdialog", ["--title", "AgentNet", "--msgbox", message + "\n\nOpen " + appName + " to answer."], signal);
  },
};

// ─────────────────────────── Windows: PowerShell + WinForms ───────────────────────────
// Single-quoted PowerShell strings: escape ' by doubling it. Options are emitted as a PS array
// literal. The choice form prints selected items (one per line) then a "TEXT<US>" line.
function psEsc(s: string): string {
  return String(s ?? "").replace(/'/g, "''").replace(/\r?\n/g, " ");
}
function psArray(items: string[]): string {
  return "@(" + items.map((i) => `'${psEsc(i)}'`).join(",") + ")";
}
const pwsh = (script: string, signal: AbortSignal) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], signal);

const winPrompter: Prompter = {
  // A WinForms form with three buttons (Approve / Always / Deny) so it matches the webview card;
  // each button prints its token and closes. A closed window prints nothing -> null.
  async askMain({ title, body }, signal) {
    const script =
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ` +
      `$f=New-Object System.Windows.Forms.Form; $f.Text='${psEsc(title)}'; $f.Width=470; $f.Height=250; $f.StartPosition='CenterScreen'; $f.TopMost=$true; ` +
      `$l=New-Object System.Windows.Forms.Label; $l.Text='${psEsc(body)}'; $l.AutoSize=$false; $l.Width=440; $l.Height=116; $l.Left=12; $l.Top=10; $f.Controls.Add($l); ` +
      `$h=New-Object System.Windows.Forms.Label; $h.Text='Press [Enter] to approve'; $h.AutoSize=$true; $h.Left=12; $h.Top=134; $h.ForeColor=[System.Drawing.Color]::Gray; $h.Font=New-Object System.Drawing.Font($f.Font.FontFamily,7.5); $f.Controls.Add($h); ` +
      `$script:res=''; ` +
      `$ap=New-Object System.Windows.Forms.Button; $ap.Text='Approve'; $ap.Left=12; $ap.Top=160; $ap.Width=135; $ap.Add_Click({$script:res='ONCE';$f.Close()}); $f.Controls.Add($ap); $f.AcceptButton=$ap; ` +
      `$al=New-Object System.Windows.Forms.Button; $al.Text='Always'; $al.Left=157; $al.Top=160; $al.Width=135; $al.Add_Click({$script:res='ALWAYS';$f.Close()}); $f.Controls.Add($al); ` +
      `$dn=New-Object System.Windows.Forms.Button; $dn.Text='Deny'; $dn.Left=302; $dn.Top=160; $dn.Width=135; $dn.Add_Click({$script:res='DENY';$f.Close()}); $f.Controls.Add($dn); ` +
      `[void]$f.ShowDialog(); $script:res`;
    const r = await pwsh(script, signal);
    if (r.code !== 0) return null;
    const out = r.stdout.trim();
    return out === "ONCE" ? "once" : out === "ALWAYS" ? "always" : out === "DENY" ? "deny" : null;
  },
  async askReason({ title }, signal) {
    // A textbox + Deny/Cancel form; Cancel (or a closed window) = back to the buttons.
    const script =
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ` +
      `$f=New-Object System.Windows.Forms.Form; $f.Text='${psEsc(title)}'; $f.Width=470; $f.Height=210; $f.StartPosition='CenterScreen'; $f.TopMost=$true; ` +
      `$l=New-Object System.Windows.Forms.Label; $l.Text='Deny - add a message for the agent (optional):'; $l.AutoSize=$false; $l.Width=440; $l.Height=40; $l.Left=12; $l.Top=10; $f.Controls.Add($l); ` +
      `$tb=New-Object System.Windows.Forms.TextBox; $tb.Width=440; $tb.Left=12; $tb.Top=54; $f.Controls.Add($tb); ` +
      `$ok=New-Object System.Windows.Forms.Button; $ok.Text='Deny'; $ok.Left=262; $ok.Top=110; $ok.Width=90; $ok.DialogResult='OK'; $f.Controls.Add($ok); $f.AcceptButton=$ok; ` +
      `$cx=New-Object System.Windows.Forms.Button; $cx.Text='Cancel'; $cx.Left=358; $cx.Top=110; $cx.Width=90; $cx.DialogResult='Cancel'; $f.Controls.Add($cx); $f.CancelButton=$cx; ` +
      `if($f.ShowDialog() -eq 'OK'){ 'OK' + [char]31 + $tb.Text }`;
    const r = await pwsh(script, signal);
    if (signal.aborted) return null;
    if (r.code !== 0) return { back: true };
    const out = r.stdout.trim();
    return out.startsWith("OK") ? { reason: out.split("\x1f")[1]?.trim() || undefined } : { back: true };
  },
  async askChoice({ question, header, options, multi, allowCustom }, signal) {
    const labels = options.map((o) => o.label);
    if (allowCustom) labels.push(SENTINEL);
    // A WinForms form: a (Checked)ListBox of options + OK/Cancel. On OK, print each selected
    // item on its own line. (Custom text, if the sentinel is picked, is gathered in a follow-up.)
    const listType = multi ? "CheckedListBox" : "ListBox";
    const collect = multi
      ? `$sel=@(); foreach($i in $lb.CheckedItems){ $sel+=$i }; $sel -join [char]10`
      : `$lb.SelectedItem`;
    const script =
      `Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; ` +
      `$f=New-Object System.Windows.Forms.Form; $f.Text='${psEsc(header || "AgentNet")}'; $f.Width=420; $f.Height=360; $f.StartPosition='CenterScreen'; $f.TopMost=$true; ` +
      `$l=New-Object System.Windows.Forms.Label; $l.Text='${psEsc(question)}'; $l.AutoSize=$false; $l.Width=380; $l.Height=48; $l.Left=12; $l.Top=10; $f.Controls.Add($l); ` +
      `$lb=New-Object System.Windows.Forms.${listType}; $lb.Width=380; $lb.Height=200; $lb.Left=12; $lb.Top=64; ${multi ? "$lb.CheckOnClick=$true; " : ""}` +
      `${psArray(labels)} | ForEach-Object { [void]$lb.Items.Add($_) }; $f.Controls.Add($lb); ` +
      `$ok=New-Object System.Windows.Forms.Button; $ok.Text='OK'; $ok.Left=214; $ok.Top=280; $ok.DialogResult='OK'; $f.Controls.Add($ok); $f.AcceptButton=$ok; ` +
      `$cx=New-Object System.Windows.Forms.Button; $cx.Text='Cancel'; $cx.Left=300; $cx.Top=280; $cx.DialogResult='Cancel'; $f.Controls.Add($cx); $f.CancelButton=$cx; ` +
      `if($f.ShowDialog() -eq 'OK'){ ${collect} }`;
    const r = await pwsh(script, signal);
    if (r.code !== 0) return null;
    let selected = r.stdout.trim().split("\n").map((s) => s.trim()).filter(Boolean);
    if (!selected.length) return null;
    let text: string | undefined;
    if (allowCustom && selected.indexOf(SENTINEL) >= 0) {
      selected = selected.filter((s) => s !== SENTINEL);
      const e = await pwsh(
        `Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('${psEsc(question)}','AgentNet','')`,
        signal,
      );
      if (e.code === 0) text = e.stdout.trim() || undefined;
    }
    return { selected, ...(text ? { text } : {}) };
  },
  async route({ appName, message }, signal) {
    await pwsh(
      `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show('${psEsc(message)} Open ${psEsc(appName)} to answer.','AgentNet','OK','Information')`,
      signal,
    );
  },
};

// Detect the right Prompter for this machine (once). Linux probes zenity then kdialog.
let prompterCache: Promise<Prompter | null> | undefined;
function getPrompter(): Promise<Prompter | null> {
  if (!prompterCache) {
    prompterCache = (async () => {
      if (process.platform === "darwin") return macPrompter;
      if (process.platform === "win32") return winPrompter;
      if (process.platform === "linux") {
        const ac = new AbortController();
        if ((await run("which", ["zenity"], ac.signal)).ok) return zenityPrompter;
        if ((await run("which", ["kdialog"], ac.signal)).ok) return kdialogPrompter;
        return null; // no desktop dialog tool -> webview only
      }
      return null;
    })();
  }
  return prompterCache;
}

// Decide + show the right popup for a request. Returns the decision, or null when cancelled /
// dismissed / routed to VS Code (the webview card stays the way to answer). Tiering:
//   tool approval          -> askMain [Approve][Always][Deny]; Deny -> askReason (Cancel = back)
//   1 question             -> askChoice (buttons for <=3 single-select, else a pick list)
//   >=2 questions          -> route to VS Code (the rich webview card handles a wizard)
// `sessionTitle` names the session/tab the request came from, so a user with several open can
// tell which one is asking; it's shown in every dialog's title bar.
async function showPopup(req: ApprovalRequest, appName: string, sessionTitle: string | undefined, signal: AbortSignal): Promise<ApprovalDecision | null> {
  const prompter = await getPrompter();
  if (!prompter) return null;
  const ses = sessionTitle ? trunc(sessionTitle, 70) : "";

  if (req.kind === "question" && Array.isArray(req.questions) && req.questions.length) {
    const header = [ses, req.questions[0]?.header].filter(Boolean).join(" · ") || "AgentNet";
    if (req.questions.length >= 2) {
      const who = ses ? `"${ses}": ` : "";
      await prompter.route({ appName, message: who + req.questions.length + " questions need your input." }, signal).catch(() => {});
      return null;
    }
    const q = req.questions[0];
    const r = await prompter.askChoice(
      { question: q.question, header, options: q.options || [], multi: !!q.multiSelect, allowCustom: !!q.allowCustomInput },
      signal,
    );
    if (!r) return null;
    return { outcome: "once", questionResponses: [{ question: q.question, questionId: q.id, selected: r.selected, ...(r.text ? { text: r.text } : {}) }] };
  }

  // Tool approval: mirror the webview card — [Approve][Always][Deny], and Deny opens a reason
  // input whose Cancel returns to the buttons. The loop makes that back-navigation OS-agnostic.
  const title = ses ? "AgentNet · " + ses : "AgentNet approval";
  const body = toolBody(req);
  const danger = req.risk === "danger";
  for (;;) {
    const main = await prompter.askMain({ title, body, danger }, signal);
    if (main === null) return null;
    if (main === "once" || main === "always") return { outcome: main };
    const rr = await prompter.askReason({ title }, signal);
    if (rr === null) return null;
    if ("back" in rr) continue; // Cancel on the reason input -> back to Approve/Always/Deny
    return { outcome: "deny", reason: rr.reason };
  }
}

// The decorator. Wrap the real (webview-backed) channel; on an unfocused request, race a native
// popup against it and keep both surfaces in sync.
export class NotifyingApprovalChannel implements ApprovalChannel {
  constructor(
    private inner: ApprovalChannel,
    private transport: NotifyTransport,
    private appName: string,
    // Resolve the human title of the session a request belongs to (for the popup title bar).
    private sessionTitleOf?: (req: ApprovalRequest) => string | undefined,
  ) {}

  async request(req: ApprovalRequest): Promise<ApprovalDecision> {
    // Focused (or an unsupported platform): the webview card is already on-screen — nothing to add.
    if (vscode.window.state.focused) return this.inner.request(req);

    const ac = new AbortController();
    let settled = false;
    // Focus back = user returned to VS Code -> tear down the modal, let them use the card.
    const focusSub = vscode.window.onDidChangeWindowState((e) => {
      if (e.focused) ac.abort();
    });

    // Popup path: an answer is injected as if the webview posted it, so `inner` resolves and
    // dupe-guards; then clear the stale card. A cancel/abort yields null -> card stays.
    const sessionTitle = this.sessionTitleOf?.(req);
    const popup = showPopup(req, this.appName, sessionTitle, ac.signal)
      .then((decision) => {
        if (decision && !settled) {
          this.transport.inject({
            type: "approvalDecision",
            id: req.id,
            outcome: decision.outcome,
            reason: decision.reason,
            questionResponses: decision.questionResponses,
          });
          this.transport.send({ type: "approvalDismiss", id: req.id });
        }
      })
      .catch(() => {}); // cancelled / aborted / no dialog tool -> webview remains the way to answer

    try {
      const decision = await this.inner.request(req); // resolves via webview OR popup inject
      settled = true;
      ac.abort(); // kill the modal if it's still up
      return decision;
    } finally {
      focusSub.dispose();
      void popup;
    }
  }

  drain(reason?: string): void {
    this.inner.drain?.(reason);
  }
}
