import { supabase } from '../supabase';

/**
 * Get historical correlation data: which organic signal types produce the best ad ROI.
 * Used by the ad recommender to weight recommendations.
 */
export async function getCorrelationInsights(): Promise<{
  bySignalType: Record<string, {
    campaigns: number;
    totalSpend: number;
    totalConversions: number;
    avgRoas: number;
    rating: string;
  }>;
  bestSignalType: string | null;
}> {
  const { data } = await supabase
    .from('reddit_agent_ad_signal_correlation')
    .select('source_signal_type, total_spend, total_conversions, total_roas, performance_rating');

  const bySignalType: Record<string, {
    campaigns: number;
    totalSpend: number;
    totalConversions: number;
    avgRoas: number;
    rating: string;
  }> = {};

  for (const row of data || []) {
    const type = row.source_signal_type;
    if (!bySignalType[type]) {
      bySignalType[type] = { campaigns: 0, totalSpend: 0, totalConversions: 0, avgRoas: 0, rating: 'low' };
    }
    bySignalType[type].campaigns++;
    bySignalType[type].totalSpend += row.total_spend || 0;
    bySignalType[type].totalConversions += row.total_conversions || 0;
  }

  // Compute averages
  let bestType: string | null = null;
  let bestRoas = 0;

  for (const [type, stats] of Object.entries(bySignalType)) {
    stats.avgRoas = stats.totalSpend > 0 ? stats.totalConversions / stats.totalSpend : 0;
    stats.rating = stats.avgRoas >= 2 ? 'high' : stats.avgRoas >= 1 ? 'medium' : 'low';

    if (stats.avgRoas > bestRoas) {
      bestRoas = stats.avgRoas;
      bestType = type;
    }
  }

  return { bySignalType, bestSignalType: bestType };
}
