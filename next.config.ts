import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

/*
 * Content Security Policy: everything comes from our own origin. Besides limiting XSS,
 * this enforces the availability rule: a dependency on a CDN or third-party service
 * (fonts, scripts, analytics) is blocked in the browser and shows up immediately.
 * 'unsafe-inline' scripts are needed by Next.js without per-request nonces; moving to
 * nonces is tracked in decisions D-019.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
  // Camera stays available to our own pages for QR card scanning (M2).
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  // The Docker image (deploy PR) builds with BUILD_STANDALONE=1 for a minimal server bundle;
  // local `pnpm start` and e2e use the regular output, which `next start` requires.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // Native Argon2 binding: load from node_modules at runtime rather than bundling it.
  serverExternalPackages: ["@node-rs/argon2"],
  // The common-password list is read from disk at runtime; make sure server builds carry it.
  outputFileTracingIncludes: { "/**": ["./src/server/auth/data/common-passwords.txt"] },
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
