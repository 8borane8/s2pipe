import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
	plugins: [preact()],

	// Keep Rust compiler errors readable in the `tauri dev` output.
	clearScreen: false,

	server: {
		// Tauri loads this exact port, so failing is better than falling back.
		port: 1420,
		strictPort: true,
		watch: {
			ignored: ["**/src-tauri/**"],
		},
	},
});
