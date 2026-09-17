import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { BlogFeed } from './BlogFeed';
const store = vi.hoisted(() => ({ state: { walletAddress: null, toast: null, blogFeed: null as any, blogPosts: {} as Record<string, any>, blogReadErrors: {} as Record<string, string> }, send: vi.fn() }));
vi.mock('../state/store', () => ({ useStore: () => store, skillCardFiring: () => false }));
vi.mock('./AgentProfileView', () => ({ BlogPostView: ({post}: any) => <div data-testid="post-body">{post.text}</div>, GithubCard: () => null, Modal: () => null, NoteComposer: () => null, PenIcon: () => null, shortWallet: (s:string) => s, noteDate: () => '' }));
let root: Root, host: HTMLDivElement;
const preview = { id: 'post', author: 'author', title: 'Open preview', text: 'Unverified mirror text', timestamp: 1 };
async function render() { await act(async () => root.render(<BlogFeed />)); }
async function click(text: string) { await act(async () => { const b = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(b).toBeTruthy(); b!.click(); }); }
beforeEach(() => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 store.state.blogFeed = [preview]; store.state.blogPosts = {}; store.state.blogReadErrors = {}; store.send.mockClear();
 host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('does not open a mirrored body when the author table has no matching post', async () => {
 await render(); await click('Open preview');
 store.state.blogPosts.post = null; await render();
 expect(host.querySelector('[data-testid="post-body"]')).toBeNull();
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("unavailable from the author's table");
 await click('Try again'); expect(store.send).toHaveBeenLastCalledWith({ type:'getBlogPost', author:'author', postId:'post' });
 store.state.blogPosts.post = {...preview, text:'Verified author body'}; await render();
 expect(host.querySelector('[data-testid="post-body"]')?.textContent).toBe('Verified author body');
});
it('shows a retry for feed errors instead of claiming the feed is empty', async () => {
 store.state.blogFeed = []; store.state.blogReadErrors.feed = 'Gateway unavailable'; await render();
 expect(host.textContent).toContain('Could not load posts'); expect(host.textContent).not.toContain('No posts yet');
 await click('Try again'); expect(store.send).toHaveBeenLastCalledWith({type:'getBlogFeed',sort:'active',fresh:true});
 store.state.blogReadErrors = {}; await render(); expect(host.textContent).toContain('No posts yet');
});
