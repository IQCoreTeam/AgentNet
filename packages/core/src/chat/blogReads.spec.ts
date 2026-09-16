import { describe, it, expect } from 'vitest';
import { createBlogReads } from './blogReads.js';
import type { MarketEvent } from './marketMessages.js';
import type { Note } from '../core/types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const note = { id: 'post', author: 'wallet', text: '안녕하세요' } as Note;

describe('blog response ordering and failures', () => {
  it('discards an older feed sort that finishes last', async () => {
    const events: MarketEvent[] = [];
    const reads = createBlogReads(event => events.push(event));
    const slow = deferred<Note[]>();
    const old = reads.handle({ type: 'getBlogFeed', sort: 'active' }, { getBlogFeed: () => slow.promise });
    await reads.handle({ type: 'getBlogFeed', sort: 'latest' }, { getBlogFeed: async () => [note] });
    slow.resolve([]);
    await old;
    expect(events).toEqual([{ type: 'blogFeed', posts: [note] }]);
  });

  it('invalidates a pending thread read when a comment succeeds', async () => {
    const events: MarketEvent[] = [];
    const reads = createBlogReads(event => events.push(event));
    const slow = deferred<[]>();
    const pending = reads.handle({ type: 'getBlogComments', postId: 'post' }, { getBlogComments: () => slow.promise });
    reads.invalidateComments('post');
    slow.resolve([]);
    await pending;
    expect(events).toEqual([]);
  });

  it('distinguishes a failed read from an empty feed and permits retry', async () => {
    const events: MarketEvent[] = [];
    const reads = createBlogReads(event => events.push(event));
    await reads.handle({ type: 'getBlogFeed' }, { getBlogFeed: async () => { throw Error('gateway unavailable'); } });
    await reads.handle({ type: 'getBlogFeed' }, { getBlogFeed: async () => [] });
    expect(events).toEqual([
      { type: 'blogFeed', posts: [], error: 'gateway unavailable' },
      { type: 'blogFeed', posts: [] },
    ]);
  });

  it('keeps independent post reads and reports missing data separately from errors', async () => {
    const events: MarketEvent[] = [];
    const reads = createBlogReads(event => events.push(event));
    const slow = deferred<Note | null>();
    const pending = reads.handle({ type: 'getBlogPost', author: 'wallet', postId: 'a' }, { getBlogPost: () => slow.promise });
    await reads.handle({ type: 'getBlogPost', author: 'wallet', postId: 'b' }, { getBlogPost: async () => { throw Error('offline'); } });
    slow.resolve(null);
    await pending;
    expect(events).toEqual([
      { type: 'blogPost', postId: 'b', post: null, error: 'offline' },
      { type: 'blogPost', postId: 'a', post: null },
    ]);
  });

  it('discards errors from superseded requests too', async () => {
    const events: MarketEvent[] = [];
    const reads = createBlogReads(event => events.push(event));
    const slow = deferred<Note[]>();
    const pending = reads.handle({ type: 'getBlogFeed' }, { getBlogFeed: () => slow.promise });
    await reads.handle({ type: 'getBlogFeed' }, { getBlogFeed: async () => [note] });
    slow.reject(Error('old failure'));
    await pending;
    expect(events).toEqual([{ type: 'blogFeed', posts: [note] }]);
  });
});
