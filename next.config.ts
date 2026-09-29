import type { NextConfig } from 'next';

/**
 * One identity per build, used in two places that must agree: Next's own build id,
 * and the `?v=` on the service-worker registration.
 *
 * The service worker keys its caches off that value. Without it the cache name was a
 * hardcoded constant, so `activate` - which deletes every cache that is not the current
 * one - never found anything to delete, and the precached app shell was written once on
 * first install and never refreshed again.
 *
 * Set BUILD_ID in CI to make a build reproducible; otherwise each build gets its own.
 */
const buildId = process.env.BUILD_ID ?? String(Date.now());

const nextConfig: NextConfig = {
  reactStrictMode: true,
  generateBuildId: async () => buildId,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
};

export default nextConfig;
