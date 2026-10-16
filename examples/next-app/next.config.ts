import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // Let the dev server be opened as 127.0.0.1 too (Next blocks non-localhost dev origins by default).
  allowedDevOrigins: ["127.0.0.1"],
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
      // Development only: stamp data-src="file:line:col" on JSX elements for the
      // Harness Studio Preview tab. Never runs in `next build` or on node_modules.
      "*.{jsx,tsx}": {
        condition: { all: ["development", { not: "foreign" }] },
        loaders: [
          { loader: "devpreview-source-loader", options: { root: process.cwd() } },
        ],
        // No `as`: the output keeps the file's own .jsx/.tsx type (an `as` renames the
        // module and breaks relative imports between components).
      },
    },
  },
};

export default nextConfig;
