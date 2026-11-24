/**
 * Prize claim codes on the server: store, service, claim / staff pages and the LAN claim
 * listener. Flow, booth setup, privacy and security: docs/REWARDS.md.
 */
import type { ServerConfig } from '../config';
import { selectClaimBase } from './claimBase';
import type { ClaimTarget } from './service';

export { createBrandAssets, type BrandAssets, type BrandFile } from './assets';
export { firstLanIPv4, selectClaimBase, type ClaimBaseInput } from './claimBase';
export { generateCode, uniqueCode, type RandomBytes } from './codes';
export { startClaimListener, type ClaimListener } from './listener';
export {
  REWARD_RATES,
  createClaimApp,
  createClaimRoutes,
  createRewardApiRoutes,
  createStaffRoutes,
  isSameOriginPost,
  makeClientKey,
  preferredLang,
  rootOf,
  storeWarnings,
  type AdminTokenCheck,
  type RewardAuthDeps,
  type RewardRouteDeps,
} from './routes';
export { RewardFailure, allowedChoices, createRewardsService, type ClaimTarget, type RewardCounts, type RewardState, type RewardsService } from './service';
export {
  KEEP_EXPIRED_MS,
  MAX_RECORDS,
  REWARDS_FILE,
  RewardStore,
  StorageError,
  createFileRewardStorage,
  createMemoryRewardStorage,
  salvageRecords,
  type LoadReport,
  type RewardStorage,
} from './store';
export { parseIssueRequest } from './validate';

/** Where QR links point before the claim listener is up (or when it is off): the external URL or the main server. */
export function initialClaimTarget(config: ServerConfig): ClaimTarget {
  return selectClaimBase({ publicUrl: config.rewards.publicUrl, listenerPort: null, lanAddress: null, mainPort: config.port });
}
