import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Same key name as vox-core / Places (New); Vite aliases also accepted.
  const googleMapsKey =
    env.GOOGLE_MAPS_API_KEY ||
    env.VITE_GOOGLE_MAPS_API_KEY ||
    env.VOX_GOOGLE_MAPS_API_KEY ||
    "";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    define: {
      "import.meta.env.GOOGLE_MAPS_API_KEY": JSON.stringify(googleMapsKey),
      "import.meta.env.VITE_GOOGLE_MAPS_API_KEY": JSON.stringify(googleMapsKey),
      "import.meta.env.VOX_GOOGLE_MAPS_API_KEY": JSON.stringify(googleMapsKey),
    },
    worker: {
      format: "es",
    },
    optimizeDeps: {
      exclude: ["maplibre-gl"],
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});