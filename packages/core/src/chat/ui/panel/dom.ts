// The shell refs nearly every section reads. Casts are the concrete element types of the
// markup in webview.ts; feature-specific refs stay in the module that owns them.
export const log = document.getElementById('log') as HTMLDivElement;
export const mainEl = document.getElementById('main') as HTMLDivElement;
export const loadingEl = document.getElementById('loading') as HTMLDivElement;
export const jumpBtn = document.getElementById('jumpBtn') as HTMLButtonElement;
export const input = document.getElementById('input') as HTMLTextAreaElement;
export const sessList = document.getElementById('sessList') as HTMLDivElement;
export const showAll = document.getElementById('showAll') as HTMLDivElement;
export const emptyEl = document.getElementById('empty') as HTMLDivElement;
export const modelBtn = document.getElementById('modelBtn') as HTMLButtonElement;
export const modelMenu = document.getElementById('modelMenu') as HTMLDivElement;
export const modelLabel = document.getElementById('modelLabel') as HTMLSpanElement;
export const composer = document.getElementById('composer') as HTMLDivElement;
export const modeBtn = document.getElementById('modeBtn') as HTMLButtonElement;
export const modeMenu = document.getElementById('modeMenu') as HTMLDivElement;
export const modeLabel = document.getElementById('modeLabel') as HTMLSpanElement;
export const modeEffortTag = document.getElementById('modeEffortTag') as HTMLSpanElement;
export const ctxMeter = document.getElementById('ctxMeter') as HTMLSpanElement;
export const approvalDock = document.getElementById('approvalDock') as HTMLDivElement;
export const engineBanner = document.getElementById('engineBanner') as HTMLDivElement;
export const slashMenu = document.getElementById('slashMenu') as HTMLDivElement;
export const tabs = Array.from(document.querySelectorAll('.etab')) as HTMLElement[];
