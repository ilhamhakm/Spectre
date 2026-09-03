import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@zip.js/zip.js/lib/zip-no-worker.js": "@zip.js/zip.js",
    };
    config.watchOptions = {
      ignored: ["**/node_modules/**", "**/.playwright-cli/**", "**/.next/**", "**/out/**"],
      poll: false,
    };
    return config;
  },
};

export default nextConfig;
