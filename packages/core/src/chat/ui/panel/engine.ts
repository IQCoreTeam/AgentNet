// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireEngine() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { CHAT_MODEL_OPTIONS } from "../../modelOptions.js";
import { CODEX_UPDATE_COMMAND, ENGINE_INSTALL_COMMAND } from "../../../runtime/engineInstall.js";
import { vscode } from "./host.js";
import { composer, input, jumpBtn, modeBtn, modeEffortTag, modeLabel, modeMenu, modelBtn, modelLabel, modelMenu, tabs } from "./dom.js";
import { renderEngineMissing, renderNotice } from "./shell.js";
import { closeMenus } from "./menus.js";

// Platform = which CLI. Model = the actual model inside it. This shared catalog is
// also used by the CLI picker so surfaces don't drift (the old webview list had stale
// Codex entries that no longer matched the CLI).
export const MODELS = CHAT_MODEL_OPTIONS;
// Per-engine install command, shown when an engine is missing so the notice is
// actionable (run in a visible terminal / copy) instead of a dead end.
export const CODEX_UPDATE_CMD = CODEX_UPDATE_COMMAND;
export const modelValue = (opt) => (opt && opt.value) ? opt.value : 'default';
// Permission/approval mode per engine. claude → SDK permissionMode; codex → a
// sandbox+approval preset (mapped host-side in spawn). Like MODELS this is just a
// wrapper label table — when a CLI changes its modes, only this list needs editing.
// English labels mirror what each CLI calls these modes natively.
export const MODES = {
  claude: [
    { value: 'default',     label: 'Ask edits',    title: 'Ask before each file edit (default)' },
    { value: 'acceptEdits', label: 'Auto edit',    title: 'Auto-accept file edits; still ask for other tools' },
    { value: 'plan',        label: 'Plan',         title: 'Plan mode: read-only until you approve the plan' },
    { value: 'bypassPermissions', label: 'Bypass', title: 'Bypass all permission prompts (--dangerously-skip-permissions). Auto-runs every command, edit, and on-chain spend. Use with care.' },
  ],
  codex: [
    { value: 'readonly', label: 'Read only',   title: 'Read-only sandbox; ask before edits, commands, network' },
    { value: 'auto',     label: 'Auto accept', title: 'Auto-accept edits + run inside the workspace; approve on failure (default)' },
    { value: 'full',     label: 'Full access', title: 'Full disk + network access, never ask (use with care)' },
  ],
};
// reasoning effort levels (applies to both engines; labels mirror CLI EffortPicker)
export const EFFORTS = [
  { value: 'default', label: 'default',  title: 'Engine default (usually medium)' },
  { value: 'low',     label: 'low',      title: 'Minimal thinking, fastest' },
  { value: 'medium',  label: 'medium',   title: 'Moderate reasoning' },
  { value: 'high',    label: 'high',     title: 'Deeper thinking' },
  { value: 'xhigh',  label: 'x-high',   title: 'Extended reasoning' },
  { value: 'max',     label: 'max',      title: 'Maximum effort (select models)' },
];
// remember the chosen mode + model + effort per engine so switching tabs restores them.
// model starts null (not 'default') so currentModel() falls to the first real model and
// the chip shows its actual name (e.g. "Opus 4.8") instead of an opaque "default".
export const modeByCli = { claude: 'acceptEdits', codex: 'auto' };
export const modelByCli = { claude: null, codex: null };
export const effortByCli = { claude: 'default', codex: 'default' };

// ---- platform tabs + model picker (chip + popover, mirroring the mode picker) ----
export function currentModel() {
  const opts = MODELS[S.cli] || [];
  return modelByCli[S.cli] || modelValue(opts[0]);
}
// Build the model picker for the active engine: set the chip label to the current
// model and render one popover row per model (label + actual value + a check on the
// selected one). Keep the chip concise; put the extra detail in the picker rows.
export function fillModels() {
  const opts = MODELS[S.cli] || [{ chipLabel: 'default', label: 'Default', description: 'No model override' }];
  const cur = currentModel();
  const curOpt = opts.find(o => modelValue(o) === cur) || opts[0];
  modelLabel.textContent = curOpt ? (curOpt.chipLabel || curOpt.label) : (cur === 'default' ? 'default' : cur);
  modelMenu.innerHTML = '';
  for (const m of opts) {
    const row = document.createElement('div');
    const value = modelValue(m);
    row.className = 'modeOpt' + (value === cur ? ' sel' : '');
    const txt = document.createElement('div'); txt.className = 'mtext';
    const lab = document.createElement('div'); lab.className = 'mlabel'; lab.textContent = m.label;
    txt.appendChild(lab);
    if (m.description) { const d = document.createElement('div'); d.className = 'mdesc'; d.textContent = m.description; txt.appendChild(d); }
    const chk = document.createElement('span'); chk.className = 'mcheck'; chk.textContent = '✓';
    row.appendChild(txt); row.appendChild(chk);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      modelByCli[S.cli] = value;
      modelMenu.style.display = 'none';
      fillModels();
      vscode.postMessage({ type: 'model', model: value });
    });
    modelMenu.appendChild(row);
  }
}
export function applyModelOptions(engine, options) {
  if (!engine || !Array.isArray(options) || !options.length) return;
  MODELS[engine] = options;
  const cur = modelByCli[engine] || 'default';
  const changed = !options.some((o) => modelValue(o) === cur);
  if (changed) modelByCli[engine] = modelValue(options[0]);
  if (engine === S.cli) {
    fillModels();
    if (changed) vscode.postMessage({ type: 'model', model: currentModel() });
  }
}
// Float a popover just above its anchor chip (composer sits at the bottom, so menus open
// upward) and center it horizontally in the viewport, clamped to an 8px margin. A left-
// anchored menu clips off the right edge in a narrow panel; centering keeps a wide popover
// fully on-screen, and the selected row's highlight already shows the active choice, so it
// need not stay pinned to the chip. Width is measured after display:block (0 while hidden).
function placeMenuAbove(menu: HTMLElement, anchor: DOMRect) {
  const mw = menu.getBoundingClientRect().width;
  const left = Math.max(8, Math.min((window.innerWidth - mw) / 2, window.innerWidth - mw - 8));
  menu.style.left = left + 'px';
  menu.style.bottom = (window.innerHeight - anchor.top + 6) + 'px';
}
export function openModelMenu() {
  modelMenu.style.display = 'block';
  placeMenuAbove(modelMenu, modelBtn.getBoundingClientRect());
}
// the currently selected permission mode for the active engine
export function currentMode() {
  const opts = MODES[S.cli] || [];
  return modeByCli[S.cli] || (opts[0] && opts[0].value);
}
// Build the mode picker for the active engine: set the chip label to the current
// mode and render one popover row per mode (label + description + a check on the
// selected one). Re-run on tab switch and after a selection so both stay in sync.
export function fillModes() {
  const opts = MODES[S.cli] || [{ value: 'default', label: 'default' }];
  const cur = currentMode();
  const curOpt = opts.find(o => o.value === cur) || opts[0];
  modeLabel.textContent = curOpt ? curOpt.label : 'mode';
  // the chip carries effort as a tail, but only when it's off default — nothing to
  // report otherwise, and a bare "Auto edit" stays readable in a narrow panel
  const curEff = currentEffort();
  const curEffOpt = EFFORTS.find(o => o.value === curEff);
  modeEffortTag.textContent = curEff === 'default' || !curEffOpt ? '' : '· ' + curEffOpt.label;
  modeMenu.innerHTML = '';
  for (const m of opts) {
    const row = document.createElement('div');
    row.className = 'modeOpt' + (m.value === cur ? ' sel' : '');
    const txt = document.createElement('div'); txt.className = 'mtext';
    const lab = document.createElement('div'); lab.className = 'mlabel'; lab.textContent = m.label;
    txt.appendChild(lab);
    if (m.title) { const d = document.createElement('div'); d.className = 'mdesc'; d.textContent = m.title; txt.appendChild(d); }
    const chk = document.createElement('span'); chk.className = 'mcheck'; chk.textContent = '✓';
    row.appendChild(txt); row.appendChild(chk);
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      modeByCli[S.cli] = m.value;
      modeMenu.style.display = 'none';
      fillModes();
      vscode.postMessage({ type: 'mode', mode: m.value });
    });
    modeMenu.appendChild(row);
  }
  // effort, below the modes in the same popover: both answer "how does this engine run",
  // so they share a menu. Chips instead of rows keep six levels from doubling its height.
  const div = document.createElement('div'); div.className = 'mdiv';
  const head = document.createElement('div'); head.className = 'mSection';
  head.textContent = 'Effort · reasoning depth';
  const chips = document.createElement('div'); chips.className = 'effChips';
  for (const e of EFFORTS) {
    const chip = document.createElement('button');
    chip.className = 'effChip' + (e.value === curEff ? ' sel' : '');
    chip.textContent = e.label;
    if (e.title) chip.title = e.title;   // the row description survives as a tooltip
    chip.addEventListener('click', (ev) => {
      ev.stopPropagation();
      effortByCli[S.cli] = e.value;
      modeMenu.style.display = 'none';
      fillModes();
      vscode.postMessage({ type: 'effort', effort: e.value === 'default' ? undefined : e.value });
    });
    chips.appendChild(chip);
  }
  modeMenu.appendChild(div); modeMenu.appendChild(head); modeMenu.appendChild(chips);
}
// open the popover anchored above the chip (composer sits at the bottom of the
// panel, so it opens upward); position:fixed keeps it out of #inputWrap's clip.
export function openModeMenu() {
  modeMenu.style.display = 'block';
  placeMenuAbove(modeMenu, modeBtn.getBoundingClientRect());
}
export function currentEffort() { return effortByCli[S.cli] || 'default'; }
export function setTab(next) {
  if (next !== 'claude' && next !== 'codex') return;
  S.cli = next;
  tabs.forEach(t => t.classList.toggle('active', t.dataset.cli === S.cli));
  composer.dataset.cli = S.cli;                       // tints the input (claude=orange/codex=green)
  if (jumpBtn) jumpBtn.dataset.cli = S.cli;           // jump button shares the send button's engine accent
  input.placeholder = 'Message ' + S.cli + '... (Enter to send)';
  fillModels();
  fillModes();
}
export function selectTab(next) {
  if (next === S.cli) return;
  setTab(next);
  const status = S.cliReport && S.cliReport[next];
  if (status === 'missing') {
    renderEngineMissing(next);
    return;
  }
  if (status === 'no-login') {
    renderNotice((next === 'claude' ? 'Claude' : 'Codex') + ' is not signed in. Type /login to connect it.');
    return;
  }
  vscode.postMessage({ type: 'platform', cli: S.cli });
  vscode.postMessage({ type: 'model', model: currentModel() });
  vscode.postMessage({ type: 'mode', mode: currentMode() });
  vscode.postMessage({ type: 'effort', effort: currentEffort() === 'default' ? undefined : currentEffort() });
}

export function wireEngine() {
  tabs.forEach(t => t.addEventListener('click', () => selectTab(t.dataset.cli)));
  // each chip toggles its own popover; clicking it again (while open) closes it
  modelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (modelMenu.style.display === 'block') { modelMenu.style.display = 'none'; return; }
    modeMenu.style.display = 'none'; closeMenus();
    openModelMenu();
  });
  modelMenu.addEventListener('click', (e) => e.stopPropagation());
  modeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (modeMenu.style.display === 'block') { modeMenu.style.display = 'none'; return; }
    modelMenu.style.display = 'none'; closeMenus();
    openModeMenu();
  });
  modeMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { modeMenu.style.display = 'none'; modelMenu.style.display = 'none'; });
  fillModels();
  fillModes();
}
