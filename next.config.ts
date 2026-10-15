import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run dev` only serves its JavaScript to localhost by default, so pages opened through a
  // Cloudflare quick tunnel or from a phone on the home Wi-Fi rendered but no button worked.
  allowedDevOrigins: ["*.trycloudflare.com", "192.168.100.*"],
  // Design files may be up to 50 MB (src/lib/files.ts); the proxy would otherwise cut request bodies at 10 MB.
  experimental: { proxyClientMaxBodySize: "60mb" },
  // The site is English only; the old Indonesian paths keep working for links already sent.
  redirects() {
    return [
      { source: "/kalkulator", destination: "/calculator", permanent: true },
      { source: "/pesan/:code", destination: "/request/:code", permanent: true },
    ];
  },
};

export default nextConfig;
