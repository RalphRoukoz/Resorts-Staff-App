import type { AssetType, Resort } from '../types/database'

export function resortLimitsForAssetType(
  resort: Pick<
    Resort,
    'chalet_weekday_limit' | 'chalet_weekend_limit' | 'cabine_weekday_limit' | 'cabine_weekend_limit'
  >,
  assetType: AssetType,
): { weekday_limit: number; weekend_limit: number } {
  if (assetType === 'cabine') {
    return {
      weekday_limit: resort.cabine_weekday_limit,
      weekend_limit: resort.cabine_weekend_limit,
    }
  }
  return {
    weekday_limit: resort.chalet_weekday_limit,
    weekend_limit: resort.chalet_weekend_limit,
  }
}
