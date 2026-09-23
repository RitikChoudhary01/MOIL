import type { NextConfig } from "next";

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Framing: keep clickjacking protection, but allow the platform preview
  // proxy (*.space-z.ai) to embed the app. Modern browsers honor CSP
  // frame-ancestors; X-Frame-Options stays as SAMEORIGIN fallback.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'self' https://*.space-z.ai https://*.z.ai https://z.ai",
  },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Type errors fail the build — non-negotiable for production.
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      {
        // Static documents — cache hard, revalidate daily
        source: "/:file.(pptx|pdf|svg|txt)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
