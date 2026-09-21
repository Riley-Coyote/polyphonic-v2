import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react()],
  define: {
    // Publish builds compile from git, where .env is gitignored, so
    // VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY would otherwise bake in
    // as `undefined` and the app crashes at startup ("supabaseUrl is required").
    // These are publishable client values (one backend serves preview + live),
    // so a literal fallback is safe; real env still wins when present.
    ...(process.env.VITE_SUPABASE_URL
      ? {}
      : {
          "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
            "https://kknchdnrujzheulqzowv.supabase.co",
          ),
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrbmNoZG5ydWp6aGV1bHF6b3d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM4MTIyMDgsImV4cCI6MjA3OTM4ODIwOH0.hO6owC0XhR7rLuCaBaSOyjDJjZTz3KB5GCMHyzOSaik",
          ),
        }),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    // The remaining >500 kB lazy chunk is Mermaid's diagram renderer, loaded
    // only for canvas artifacts. Keep the warning budget tight for initial app
    // chunks while avoiding noisy failures on that deliberate lazy engine.
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("/node_modules/")) return undefined;

          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/react-router") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }

          if (id.includes("/@supabase/")) return "vendor-supabase";

          if (
            id.includes("/react-markdown/") ||
            id.includes("/remark-") ||
            id.includes("/unified/") ||
            id.includes("/micromark") ||
            id.includes("/mdast-") ||
            id.includes("/hast-") ||
            id.includes("/unist-") ||
            id.includes("/vfile")
          ) {
            return "vendor-markdown";
          }

          if (id.includes("/recharts/") || id.includes("/d3-")) return "vendor-charts";
          if (id.includes("/@radix-ui/") || id.includes("/cmdk/") || id.includes("/vaul/")) return "vendor-ui";
          if (id.includes("/lucide-react/")) return "vendor-icons";

          return undefined;
        },
      },
    },
  },
}));
