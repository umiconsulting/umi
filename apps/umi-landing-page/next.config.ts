import { execFileSync } from 'node:child_process';
import type { NextConfig } from 'next';

try {
  if (
    typeof globalThis.localStorage !== 'undefined' &&
    typeof globalThis.localStorage.getItem !== 'function'
  ) {
    Reflect.deleteProperty(globalThis, 'localStorage');
  }
} catch {
  // Node 25 can expose a malformed server-side localStorage when no backing
  // file is configured. Browser localStorage is unaffected by this guard.
  Reflect.deleteProperty(globalThis, 'localStorage');
}

function resolveUmiposChannel(): 'production' | 'staging' {
  const explicit = process.env.NEXT_PUBLIC_UMIPOS_CHANNEL;
  if (explicit === 'staging' || explicit === 'production') {
    return explicit;
  }
  if (process.env.GITHUB_BASE_REF === 'main' || process.env.GITHUB_REF_NAME === 'main') {
    return 'production';
  }
  if (process.env.GITHUB_REF_NAME === 'staging') {
    return 'staging';
  }
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (branch === 'staging') {
      return 'staging';
    }
  } catch {
    // Default safely to production when git metadata is unavailable.
  }
  return 'production';
}

const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_UMIPOS_CHANNEL: resolveUmiposChannel(),
  },
};

export default nextConfig;
