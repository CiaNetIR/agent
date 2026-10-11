import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // CI/isolated build directory override — lets the hourly backup service run
  // a verification `next build` WITHOUT touching the live dev server's .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // private media: /agent-videos/* and /agent-images/* are intercepted BEFORE
  // the public static handler and served through the auth-checked
  // /api/media/* route (requires ?k=<panel key>) — raw URLs are no longer
  // world-readable.
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/agent-videos/:path*", destination: "/api/media/agent-videos/:path*" },
        { source: "/agent-images/:path*", destination: "/api/media/agent-images/:path*" },
      ],
    };
  },
};

export default nextConfig;
