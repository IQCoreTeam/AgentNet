import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { PublishForm } from './PublishForm';
import { readSkillDrafts } from './skillDrafts';
const store = vi.hoisted(() => ({ state: { walletAddress: null as string | null, publishResult: null, publishProgress: null, marketOwned: [], marketOwnedMints: {}, marketOwnedWorkflowMints: [] }, send: vi.fn(), clearPublishResult: vi.fn(), prefillComposer: vi.fn() }));
vi.mock('../state/store', () => ({ useStore: () => store }));
vi.mock('../haptics', () => ({ haptics: { tick: vi.fn(), strong: vi.fn() } }));
let root: Root, host: HTMLDivElement;
const back = vi.fn();
async function render(initialDraft?: ReturnType<typeof readSkillDrafts>[number]) { await act(async () => root.render(<PublishForm onBack={back} initialDraft={initialDraft} />)); }
async function fill(placeholder: string, value: string) {
  const field = placeholder.startsWith("# My Skill") ? host.querySelector("textarea")! : host.querySelector<HTMLInputElement>(`[placeholder="${placeholder}"]`)!;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); });
}
async function click(text: string) { await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!.click()); }
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); localStorage.clear(); vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('saves/reopens a local draft with no wallet, chain request or lost form fields', async () => {
  await render(); await fill('My Skill', 'qa-skill'); await fill('What does this skill do?', 'Review a local fixture.'); await fill('# My Skill&#10;&#10;## Description&#10;…', 'Read source.');
  await click('Save draft');
  const saved = readSkillDrafts()[0];
  expect(saved.name).toBe('qa-skill'); expect(saved.text).toBe('Read source.'); expect(store.send).not.toHaveBeenCalled();
  await act(async () => root.unmount()); root = createRoot(host); await render(saved);
  expect(host.querySelector<HTMLInputElement>('[placeholder="My Skill"]')!.value).toBe('qa-skill');
});
it('test only prepares editable chat context; it never sends a message or publishes', async () => {
  await render({ id: 'local', name: 'qa-skill', description: 'Read-only test', text: 'Inspect the fixture only.', category: '', hashtags: '', priceSol: '0', imageUrl: '' });
  await click('Test in chat');
  expect(store.prefillComposer).toHaveBeenCalledWith(expect.stringContaining('Inspect the fixture only.'));
  expect(store.prefillComposer.mock.calls[0][0]).toMatch(/Task: $/);
  expect(store.send).not.toHaveBeenCalled(); expect(back).toHaveBeenCalled();
});
it('storage failure keeps the editor and does not navigate or send the draft', async () => {
  await render({ id: 'local', name: 'qa-skill', description: 'Read-only test', text: 'Inspect.', category: '', hashtags: '', priceSol: '0', imageUrl: '' });
  const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('Quota exceeded'); });
  try { await click('Test in chat'); expect(host.querySelector('[role=status]')?.textContent).toContain('Quota exceeded'); expect(store.prefillComposer).not.toHaveBeenCalled(); expect(back).not.toHaveBeenCalled(); }
  finally { failure.mockRestore(); }
});
