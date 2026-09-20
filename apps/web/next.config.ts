import type { NextConfig } from "next";

// The browser only talks to this app (port 3000). Requests to /api/* are forwarded to the NestJS API.
// That keeps the session cookie on one origin, so no CORS and no cross-site cookie settings.
const API_URL = process.env.API_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  // Uploads pass through this proxy. Its default buffer is 10 MB, which cuts off files near the app's own
  // 10 MB limit (file plus form overhead). Keep this above MAX_UPLOAD_MB so the API decides and answers 413.
  experimental: { proxyClientMaxBodySize: "20mb" },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
