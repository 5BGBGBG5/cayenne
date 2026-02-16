import { supabase } from '../supabase';
import type { Keyword } from './types';

let cachedKeywords: Keyword[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load active keywords from Supabase. Cached for 5 minutes.
 */
export async function loadKeywords(): Promise<Keyword[]> {
  if (cachedKeywords && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cachedKeywords;
  }

  const { data, error } = await supabase
    .from('reddit_agent_keywords')
    .select('*')
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to load keywords: ${error.message}`);
  }

  cachedKeywords = (data || []) as Keyword[];
  cacheTime = Date.now();
  return cachedKeywords;
}

/**
 * Match post text against keywords. Returns matched keywords with their weights.
 */
export function matchKeywords(
  text: string,
  keywords: Keyword[]
): { matched: Keyword[]; highestWeight: Keyword['weight'] | null } {
  const lower = text.toLowerCase();
  const matched: Keyword[] = [];

  for (const kw of keywords) {
    if (lower.includes(kw.keyword.toLowerCase())) {
      matched.push(kw);
    }
  }

  if (matched.length === 0) {
    return { matched: [], highestWeight: null };
  }

  // Priority order: high > competitor > medium > low
  const weightOrder: Record<string, number> = { high: 4, competitor: 3, medium: 2, low: 1 };
  const sorted = [...matched].sort(
    (a, b) => (weightOrder[b.weight] || 0) - (weightOrder[a.weight] || 0)
  );

  return {
    matched: sorted,
    highestWeight: sorted[0].weight,
  };
}
