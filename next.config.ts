import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
        pathname: "/**",
      },
    ],
  },
  devIndicators: false,
  async headers() {
    return [
      {
        // ffmpeg.wasm core is content-addressable per package version —
        // safe to cache aggressively. The 32 MB wasm payload is paid once
        // per browser, not per visit.
        source: "/ffmpeg/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ]
  },
};

export default nextConfig;
