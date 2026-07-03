import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const nodeStreamShim = fileURLToPath(new URL("./src/renderer/shims/nodeStream.ts", import.meta.url));

export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      stream: nodeStreamShim,
      "node:stream": nodeStreamShim
    }
  },
  server: {
    watch: {
      ignored: ["**/.runtime/**", "**/.tmp/**", "**/dist-electron/**", "**/release/**"]
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          maxSize: 430 * 1024,
          groups: [
            {
              name: "vendor-xmind-export",
              test: /node_modules[\\/](?:simple-mind-map[\\/](?:src[\\/]plugins[\\/]ExportXMind|src[\\/]parse[\\/]xmind)|jszip|xml-js|sax)[\\/]/,
              priority: 60
            },
            {
              name: "vendor-canvas-editor",
              test: /node_modules[\\/]@hufe921[\\/]canvas-editor[\\/]/,
              priority: 50,
              maxSize: 430 * 1024
            },
            {
              name: "vendor-mindmap",
              test: /node_modules[\\/]simple-mind-map[\\/]/,
              priority: 40,
              maxSize: 430 * 1024
            },
            {
              name: "vendor-react",
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 30
            },
            {
              name: "vendor-icons",
              test: /node_modules[\\/]lucide-react[\\/]/,
              priority: 20
            }
          ]
        }
      }
    }
  }
});
