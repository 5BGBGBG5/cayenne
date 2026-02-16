import { redditGet } from './client';
import type { RedditPost, RedditComment, RedditListing, RedditUserPost } from './types';

/**
 * Fetch new posts from a subreddit.
 * Uses the `after` cursor for pagination (stored per-subreddit in Supabase).
 */
export async function getSubredditNew(
  subreddit: string,
  options: { limit?: number; after?: string } = {}
): Promise<{ posts: RedditPost[]; after: string | null }> {
  const params: Record<string, string> = {
    limit: String(options.limit || 25),
  };
  if (options.after) {
    params.after = options.after;
  }

  const listing = await redditGet<RedditListing<RedditPost>>(
    `/r/${subreddit}/new.json`,
    params
  );

  return {
    posts: listing.data.children.map(c => c.data),
    after: listing.data.after,
  };
}

/**
 * Search within a subreddit for posts matching a query.
 */
export async function searchSubreddit(
  subreddit: string,
  query: string,
  options: { limit?: number; sort?: 'relevance' | 'new' | 'hot' } = {}
): Promise<RedditPost[]> {
  const listing = await redditGet<RedditListing<RedditPost>>(
    `/r/${subreddit}/search.json`,
    {
      q: query,
      restrict_sr: 'true',
      sort: options.sort || 'new',
      limit: String(options.limit || 10),
      t: 'week',
    }
  );

  return listing.data.children.map(c => c.data);
}

/**
 * Search across all of Reddit for posts matching a query.
 */
export async function searchReddit(
  query: string,
  options: { limit?: number; sort?: 'relevance' | 'new' | 'hot' } = {}
): Promise<RedditPost[]> {
  const listing = await redditGet<RedditListing<RedditPost>>(
    '/search.json',
    {
      q: query,
      sort: options.sort || 'new',
      limit: String(options.limit || 10),
      t: 'week',
    }
  );

  return listing.data.children.map(c => c.data);
}

/**
 * Fetch comments for a post. Returns flattened top-level + first-level replies.
 */
export async function getPostComments(
  postId: string,
  subreddit: string,
  options: { limit?: number; depth?: number } = {}
): Promise<RedditComment[]> {
  // Reddit returns [post_listing, comments_listing]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await redditGet<any[]>(
    `/r/${subreddit}/comments/${postId}.json`,
    {
      limit: String(options.limit || 50),
      depth: String(options.depth || 3),
    }
  );

  const commentListing = result[1];
  return flattenComments(commentListing.data.children, 0);
}

/**
 * Flatten nested comment tree into a flat array with depth info.
 */
function flattenComments(
  children: Array<{ kind: string; data: Record<string, unknown> }>,
  depth: number
): RedditComment[] {
  const results: RedditComment[] = [];

  for (const child of children) {
    if (child.kind !== 't1') continue; // Skip "more" stubs

    const d = child.data;
    const comment: RedditComment = {
      id: d.id as string,
      name: d.name as string,
      author: d.author as string,
      body: d.body as string,
      score: d.score as number,
      created_utc: d.created_utc as number,
      parent_id: d.parent_id as string,
      depth,
      replies: null,
    };

    results.push(comment);

    // Recurse into replies
    const replies = d.replies;
    if (replies && typeof replies === 'object' && 'data' in (replies as Record<string, unknown>)) {
      const repliesListing = replies as RedditListing<Record<string, unknown>>;
      const nested = flattenComments(repliesListing.data.children as Array<{ kind: string; data: Record<string, unknown> }>, depth + 1);
      results.push(...nested);
    }
  }

  return results;
}

/**
 * Get recent posts by a user. Used by the agent loop to assess user context.
 */
export async function getUserPosts(
  username: string,
  options: { limit?: number } = {}
): Promise<RedditUserPost[]> {
  const listing = await redditGet<RedditListing<RedditUserPost>>(
    `/user/${username}/submitted.json`,
    {
      limit: String(options.limit || 25),
      sort: 'new',
      t: 'month',
    }
  );

  return listing.data.children.map(c => c.data);
}
