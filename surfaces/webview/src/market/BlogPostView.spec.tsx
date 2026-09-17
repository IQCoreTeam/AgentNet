import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { BlogPostView } from './AgentProfileView';
const store = vi.hoisted(() => ({ state: { walletAddress: 'local-wallet', blogReadErrors: {} as Record<string,string>, blogComments: {} as Record<string, any[]>, blogCommentResults: {} as Record<string, any> }, send: vi.fn() }));
vi.mock('../state/store', () => ({ useStore: () => store, skillCardFiring: () => false }));
const post = { id: 'local-post', author: 'local-author', text: 'Local QA only', timestamp: 1 };
const thread = { note: { id: 'local-comment', author: 'reader', text: 'hello', timestamp: 1 }, replies: [] };
let root: Root, host: HTMLDivElement;
async function render() { await act(async () => root.render(<BlogPostView post={post} wallet="local-author" onClose={() => {}} />)); }
const field = (reply = false) => host.querySelector<HTMLTextAreaElement>(`textarea[placeholder="Write a ${reply ? 'reply' : 'comment'}..."]`)!;
async function type(text: string, reply = false) { await act(async () => { const el = field(reply); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, text); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function click(label: string) { await act(async () => { const b = [...host.querySelectorAll('button')].find(b => b.textContent === label); expect(b).toBeTruthy(); b!.click(); }); }
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  store.state.blogReadErrors = {}; store.state.blogComments = { 'local-post': [thread] }; store.state.blogCommentResults = {}; store.send.mockClear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('preserves a Korean draft on failure, permits retry, clears only on success', async () => {
  await type('안녕하세요, 다시 시도할 댓글입니다'); await click('Comment');
  expect(field().value).toContain('안녕하세요'); expect(field().disabled).toBe(true);
  store.state.blogCommentResults['local-post'] = { ok: false, error: 'Local simulated network failure' }; await render();
  expect(field().disabled).toBe(false); expect(field().value).toContain('안녕하세요'); expect(host.querySelector('[role="alert"]')?.textContent).toContain('network failure');
  await click('Comment'); store.state.blogCommentResults['local-post'] = { ok: true }; await render();
  expect(field().value).toBe(''); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it('late comment refresh does not close a reply or acknowledge its submission', async () => {
  await click('[Reply]'); await type('reply draft', true);
  store.state.blogComments['local-post'] = [{ ...thread }]; await render(); expect(field(true).value).toBe('reply draft'); await click('Reply');
  store.state.blogComments['local-post'] = [{ ...thread }]; await render(); expect(field(true).disabled).toBe(true);
  store.state.blogCommentResults['other-post'] = { ok: true }; await render(); expect(field(true).disabled).toBe(true);
  store.state.blogCommentResults['local-post'] = { ok: false, error: 'Retry' }; await render(); expect(field(true).value).toBe('reply draft'); expect(field(true).disabled).toBe(false);
  await click('Reply'); store.state.blogCommentResults['local-post'] = { ok: true }; await render(); expect(field(true)).toBeNull();
});
it('successful reply preserves a separate top-level comment draft', async () => {
  await type('unsent top-level draft'); await click('[Reply]'); await type('reply', true); await click('Reply');
  store.state.blogCommentResults['local-post'] = { ok: true }; await render(); expect(field().value).toBe('unsent top-level draft');
});
it('repeated failures restore controls and do not consume an older result', async () => {
  store.state.blogCommentResults['local-post'] = { ok: false, error: 'Same error' }; await render();
  await type('retryable'); await click('Comment');
  expect(field().disabled).toBe(true);
  store.state.blogCommentResults['local-post'] = { ok: false, error: 'Same error' }; await render();
  expect(field().disabled).toBe(false); expect(field().value).toBe('retryable');
  await click('Comment'); expect(field().disabled).toBe(true);
  store.state.blogCommentResults['local-post'] = { ok: false, error: 'Same error' }; await render();
  expect(field().disabled).toBe(false); expect(field().value).toBe('retryable');
});

it('keeps the draft and cached comments when a thread read fails', async () => {
  await type('안녕하세요 draft');
  store.state.blogReadErrors['comments:local-post'] = 'Gateway unavailable';
  await render();
  expect(field().value).toBe('안녕하세요 draft');
  expect(host.textContent).toContain('hello');
  expect(host.textContent).toContain('Could not load comments');
  expect(host.textContent).not.toContain('No comments yet');
  await click('Try again');
  expect(store.send).toHaveBeenCalledWith({ type: 'getBlogComments', postId: 'local-post', agentWallet: 'local-author' });
});
