// Panel module cut from the legacy webview script (issue #215). Bodies are verbatim apart from
// the S.<name> state rewrite. Top-level statements live in wireViews() because ESM evaluates
// modules in dependency order, and main.ts calls the wire functions in the legacy order so
// listener registration and boot posts keep their sequence.
import { S } from "./state.js";
import { vscode } from "./host.js";
import { openPublish } from "./publish.js";
import { openAgents, updateFdFab } from "./feed.js";
import { closeMenus } from "./menus.js";
import { openMarket } from "./market.js";

// ---- view switcher: Chat / My Wallet (profile) / Market / Agents ----
export const panels = {
  chat: document.getElementById('chatView'),
  wallet: document.getElementById('walletView'),
  market: document.getElementById('marketView'),
  agents: document.getElementById('agentsView'),
  publish: document.getElementById('publishView'),
};
export function showView(name) {
  for (const k in panels) panels[k].style.display = (k === name) ? 'flex' : 'none';
  document.getElementById('marketsBtn').classList.toggle('on', name === 'market');
  document.getElementById('agentsBtn').classList.toggle('on', name === 'agents');
  if (name === 'wallet') vscode.postMessage({ type: 'wallet' }); // refresh address
  if (name === 'market') openMarket();
  if (name === 'agents') openAgents();
  updateFdFab(); // the feed FAB lives only on the visible FEED list
}

export function wireViews() {
  document.getElementById('backToChat').addEventListener('click', () => showView('chat'));
  document.getElementById('backToChatM').addEventListener('click', () => showView('chat'));
  document.getElementById('backToChatA').addEventListener('click', () => showView('chat'));
  document.getElementById('backToChatP').addEventListener('click', () => showView('chat'));
  document.getElementById('marketsBtn').addEventListener('click', () => { closeMenus(); showView('market'); });
  document.getElementById('agentsBtn').addEventListener('click', () => { closeMenus(); showView('agents'); });
  // make-skill: two entry points (market header, skills panel) → publish view. Not in the
  // top bar: publishing is a market action, and it sits where you're already looking at skills.
  // the market button follows the active tab: on the Workflows tab it opens the workflow builder
  document.getElementById('mktMakeSkillBtn').addEventListener('click', () => openPublish(S.currentKind === 'workflow' ? 'workflow' : 'skill'));
  document.getElementById('panelMakeSkillBtn').addEventListener('click', () => {
    document.getElementById('skillsPanel').style.display = 'none'; // close the panel popover
    openPublish('skill');
  });
  // panel SHOP button → the full Markets view (search/buy live there now). The panel is
  // inventory-only, so it hands off rather than duplicating a search box.
  document.getElementById('panelShopBtn').addEventListener('click', () => {
    document.getElementById('skillsPanel').style.display = 'none';
    showView('market');
  });
}
