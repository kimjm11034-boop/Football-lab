import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    if (id.indexOf("node_modules") === -1) {
                        return undefined;
                    }
                    if (id.indexOf("react-konva") !== -1 ||
                        id.indexOf("\\konva\\") !== -1 ||
                        id.indexOf("/konva/") !== -1) {
                        return "konva-vendor";
                    }
                    if (id.indexOf("d3-delaunay") !== -1 ||
                        id.indexOf("\\d3-") !== -1 ||
                        id.indexOf("/d3-") !== -1) {
                        return "analysis-vendor";
                    }
                    return "vendor";
                }
            }
        }
    },
    server: {
        port: 5173
    }
});
