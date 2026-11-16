import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  experimental: {
    turbopackMinify: false,
  },
  // The chat route reads these with fs at runtime (the generated component
  // spec and the example dashboard), so serverless bundles must include them.
  outputFileTracingIncludes: {
    "/api/chat": ["./src/generated/spec.json", "./db/seed/*.openui"],
  },
};

export default nextConfig;
