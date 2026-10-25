import type { Plugin } from "vite";

const OPTIMIZED_DEPS = "/node_modules/.vite/deps/";
const REVALIDATE = "no-cache";

export function devCacheControl(url: string | undefined, name: string, value: unknown): unknown {
  if (name.toLowerCase() !== "cache-control" || !url?.includes(OPTIMIZED_DEPS)) return value;
  return REVALIDATE;
}

export function revalidatedDeps(): Plugin {
  return {
    name: "vivepdf-revalidated-deps",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const setHeader = response.setHeader.bind(response);
        response.setHeader = (name, value) => setHeader(name, devCacheControl(request.url, name, value) as typeof value);
        next();
      });
    },
  };
}
