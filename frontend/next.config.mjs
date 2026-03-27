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
  transpilePackages: ["@provablehq/sdk", "@provablehq/wasm"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
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
    config.experiments = {
      ...config.experiments,
      topLevelAwait: true,
      asyncWebAssembly: true,
      layers: true,
    };

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
      net: false,
      tls: false,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    config.output = {
      ...config.output,
      environment: {
        ...config.output?.environment,
        asyncFunction: true,
      },
    };

    if (isServer) {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [...externals, "@provablehq/wasm", "@provablehq/sdk"];
    }

    return config;
  },
};

export default nextConfig;
