import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const rawPort = process.env.PORT;
if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}
const basePath = process.env.BASE_PATH;
if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

function signalingPlugin() {
  return {
    name: "posture-signaling",
    async configureServer(server: any) {
      try {
        const { WebSocketServer } = await import("ws");
        const wss = new WebSocketServer({ noServer: true });
        const clients = new Set<any>();
        server.httpServer?.on("upgrade", (req: any, socket: any, head: any) => {
          if (req.url === "/signal") {
            wss.handleUpgrade(req, socket, head, (ws: any) => {
              clients.add(ws);
              ws.on("message", (msg: any) => {
                clients.forEach((c) => {
                  if (c !== ws && c.readyState === 1) c.send(msg);
                });
              });
              ws.on("close", () => clients.delete(ws));
            });
          }
        });
        console.log("[PostureAI] WebSocket signaling server ready at /signal");
      } catch (e) {
        console.warn("[PostureAI] ws not found — side camera disabled");
      }
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    // ← runtimeErrorOverlay() REMOVED — was causing crash popup on mobile
    signalingPlugin(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    // ← Disable error overlay on mobile completely
    hmr: {
      overlay: false,
    },
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
