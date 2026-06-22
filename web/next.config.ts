import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The api-client ships raw TypeScript; Next must transpile it.
  transpilePackages: ["@fountainrank/api-client"],
  experimental: {
    serverActions: { allowedOrigins: ["fountainrank.com", "www.fountainrank.com"] },
  },
};

export default nextConfig;
