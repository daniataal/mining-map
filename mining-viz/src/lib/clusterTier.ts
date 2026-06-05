/** Visual tier for license cluster bubbles (server + client). */

export type ClusterTier = 'small' | 'medium' | 'large' | 'hotspot';

export function clusterTierForCount(count: number): ClusterTier {
  if (count >= 2500) return 'hotspot';
  if (count >= 501) return 'large';
  if (count >= 51) return 'medium';
  return 'small';
}

export function clusterIconSizeForTier(tier: ClusterTier): number {
  switch (tier) {
    case 'hotspot':
      return 58;
    case 'large':
      return 50;
    case 'medium':
      return 42;
    case 'small':
    default:
      return 36;
  }
}
