import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev }) => {
    if (dev) {
      // Avoid intermittent ENOENT pack cache corruption on local dev file systems.
      config.cache = false;
    }
    return config;
  },
};

export default nextConfig;
