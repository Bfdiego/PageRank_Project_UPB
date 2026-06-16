import { fileURLToPath } from "url";

const root = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Prevent Next from inferring the repo root from other lockfiles.
  // This avoids serving stale output from a different workspace root.
  turbopack: {
    root,
  },
};

export default nextConfig;
