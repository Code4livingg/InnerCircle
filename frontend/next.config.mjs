/** @type {import('next').NextConfig} */
const normalizeApiBase = (value) => {
  const trimmed = value.replace(/\/$/, "");
  return trimmed.endsWith("/api") ? trimmed.slice(0, -4) : trimmed;
};

const configuredApiBase = process.env.API_PROXY_BASE ?? process.env.NEXT_PUBLIC_API_BASE;
const apiProxyBase = configuredApiBase
  ? normalizeApiBase(configuredApiBase)
  : process.env.NODE_ENV === "development"
    ? "http://localhost:8080"
    : "";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    if (!apiProxyBase) {
      return [];
    }

    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyBase}/api/:path*`,
      },
    ];
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Wallet adapter packages use Node.js modules that need to be polyfilled
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
