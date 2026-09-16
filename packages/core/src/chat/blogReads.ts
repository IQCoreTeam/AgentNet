import type { MarketEvent, MarketRequest, ThreadNode } from './marketMessages.js';
import type { Note } from '../core/types.js';

export interface BlogReads {
  getBlogFeed?(limit?: number, sort?: 'active' | 'latest', fresh?: boolean): Promise<Note[]>;
  getBlogComments?(postId: string): Promise<ThreadNode[]>;
  getBlogPost?(author: string, postId: string): Promise<Note | null>;
}

// Per UI connection. A slow response must not replace a newer sort or a posted reply.
export function createBlogReads(send: (event: MarketEvent) => void) {
  const versions = new Map<string, number>();
  const advance = (key: string) => { const n = (versions.get(key) ?? 0) + 1; versions.set(key, n); return n; };
  return {
    invalidateComments(postId: string) { advance(`comments:${postId}`); },
    async handle(req: MarketRequest, env: BlogReads): Promise<boolean> {
      if (req.type !== 'getBlogFeed' && req.type !== 'getBlogComments' && req.type !== 'getBlogPost') return false;
      const key = req.type === 'getBlogFeed' ? 'feed' : `${req.type === 'getBlogComments' ? 'comments' : 'post'}:${req.postId}`;
      const version = advance(key);
      const publish = (event: MarketEvent) => { if (versions.get(key) === version) send(event); };
      try {
        if (req.type === 'getBlogFeed' && env.getBlogFeed) publish({type:'blogFeed',posts:await env.getBlogFeed(req.limit,req.sort,req.fresh)});
        else if (req.type === 'getBlogComments' && env.getBlogComments) publish({type:'blogComments',postId:req.postId,threads:await env.getBlogComments(req.postId)});
        else if (req.type === 'getBlogPost' && env.getBlogPost) publish({type:'blogPost',postId:req.postId,post:await env.getBlogPost(req.author,req.postId)});
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (req.type === 'getBlogFeed') publish({type:'blogFeed',posts:[],error});
        else if (req.type === 'getBlogComments') publish({type:'blogComments',postId:req.postId,threads:[],error});
        else publish({type:'blogPost',postId:req.postId,post:null,error});
      }
      return true;
    },
  };
}
