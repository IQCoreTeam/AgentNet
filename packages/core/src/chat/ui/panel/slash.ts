// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireSlash() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { CHAT_SLASH_COMMANDS, type SlashEngine } from "../../slashCommands.js";
import { input, slashMenu } from "./dom.js";
import { escapeHtml } from "./markdown.js";
import { EFFORTS, MODELS, MODES } from "./engine.js";
import { autoGrowInput } from "./composer.js";

// ---- slash command autocomplete ----
export const SLASH_CMDS = CHAT_SLASH_COMMANDS.map(function(c) {
  return Object.assign({}, c, { insert: '/' + c.name + (c.args ? ' ' : '') });
});
export function slashCommandsForCli() {
  return SLASH_CMDS.filter(function(cmd) {
    return !cmd.engines || cmd.engines.indexOf(S.cli as SlashEngine) >= 0;
  });
}

export function renderSlashMenu() {
  if (S.suppressSlash) {
    slashMenu.style.display = 'none';
    S.activeSlashMatches = [];
    return;
  }
  const val = input.value;
  
  // Check if it matches a sub-command argument first
  let subCmd = null;
  let prefix = '';
  let options = [];

  // 1. Engine options
  let m = /^\/engine(?:\s+(\S*))?$/.exec(val);
  if (m) {
    subCmd = 'engine';
    prefix = (m[1] || '').toLowerCase();
    options = [
      { name: 'claude', desc: 'switch to Claude engine', insert: '/engine claude' },
      { name: 'codex',  desc: 'switch to Codex engine',  insert: '/engine codex' }
    ];
    // custom is offered only once the host says an endpoint config exists
    if (S.customEngineOn) options.push({ name: 'custom', desc: 'switch to Custom engine', insert: '/engine custom' });
  }
  // 2. Model options
  if (!subCmd) {
    m = /^\/model(?:\s+(\S*))?$/.exec(val);
    if (m) {
      subCmd = 'model';
      prefix = (m[1] || '').toLowerCase();
      const list = MODELS[S.cli] || [];
      options = list.map(function(o) {
        return { name: o.value, desc: o.label, insert: '/model ' + o.value };
      });
    }
  }
  // 3. Mode options
  if (!subCmd) {
    m = /^\/mode(?:\s+(\S*))?$/.exec(val);
    if (m) {
      subCmd = 'mode';
      prefix = (m[1] || '').toLowerCase();
      const list = MODES[S.cli] || [];
      options = list.map(function(o) {
        return { name: o.value, desc: o.label + ' - ' + o.title, insert: '/mode ' + o.value };
      });
    }
  }
  // 4. Effort options
  if (!subCmd) {
    m = /^\/effort(?:\s+(\S*))?$/.exec(val);
    if (m) {
      subCmd = 'effort';
      prefix = (m[1] || '').toLowerCase();
      options = EFFORTS.map(function(o) {
        return { name: o.value, desc: o.label + ' - ' + o.title, insert: '/effort ' + o.value };
      });
    }
  }

  if (subCmd) {
    S.activeSlashMatches = options.filter(function(opt) {
      return opt.name.toLowerCase().startsWith(prefix);
    });
    // If the user fully typed the sub-command argument, hide the menu
    if (S.activeSlashMatches.length === 1 && prefix === S.activeSlashMatches[0].name.toLowerCase()) {
      slashMenu.style.display = 'none';
      S.activeSlashMatches = [];
      return;
    }
  } else {
    // Otherwise match the main slash commands
    const mainMatch = /^\/(\S*)$/.exec(val);
    if (!mainMatch) {
      slashMenu.style.display = 'none';
      S.activeSlashMatches = [];
      return;
    }
    prefix = mainMatch[1].toLowerCase();
    S.activeSlashMatches = slashCommandsForCli().filter(function(cmd) {
      return cmd.name.toLowerCase().startsWith(prefix);
    });
  }

  if (S.activeSlashMatches.length === 0) {
    slashMenu.style.display = 'none';
    return;
  }

  if (S.slashIdx >= S.activeSlashMatches.length) {
    S.slashIdx = S.activeSlashMatches.length - 1;
  }
  if (S.slashIdx < 0) {
    S.slashIdx = 0;
  }

  let html = '';
  S.activeSlashMatches.forEach(function(cmd, idx) {
    const isSel = idx === S.slashIdx;
    const label = subCmd ? cmd.name : '/' + cmd.name;
    html += '<div class="slashOpt' + (isSel ? ' sel' : '') + '" data-idx="' + idx + '">' +
              '<span class="cmd">' + escapeHtml(label) + '</span>' +
              '<span class="desc">' + escapeHtml(cmd.desc || '') + '</span>' +
            '</div>';
  });
  html += '<div class="slashHint">Use ↑↓ to navigate, Tab/Enter to select, Esc to close</div>';
  slashMenu.innerHTML = html;
  slashMenu.style.display = 'flex';
}

export function completeSlash(c) {
  input.value = c.insert;
  autoGrowInput();
  S.suppressSlash = false;
  slashMenu.style.display = 'none';
  S.activeSlashMatches = [];
  input.focus();
  if (c.insert.endsWith(' ')) {
    renderSlashMenu();
  }
}

export function wireSlash() {

  slashMenu.addEventListener('click', function(e) {
    const opt = (e.target as HTMLElement).closest('.slashOpt');
    if (opt) {
      e.stopPropagation();
      const idx = parseInt(opt.getAttribute('data-idx') || '0', 10);
      if (S.activeSlashMatches[idx]) {
        completeSlash(S.activeSlashMatches[idx]);
      }
    }
  });
}
