import type { NextConfig } from "next";

try {
  if (
    typeof globalThis.localStorage !== "undefined" &&
    typeof globalThis.localStorage.getItem !== "function"
  ) {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
} catch {
  // Node 25 can expose a malformed server-side localStorage when no backing
  // file is configured. Browser localStorage is unaffected by this guard.
  Reflect.deleteProperty(globalThis, "localStorage");
}

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    domains: ["images.unsplash.com"],
  },
};

export default nextConfig;
