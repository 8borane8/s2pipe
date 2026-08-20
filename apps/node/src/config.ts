function env(name: string, fallback = ""): string {
	return Deno.env.get(name) || fallback;
}

function envInt(name: string, fallback: number): number {
	const raw = Deno.env.get(name);
	if (!raw) return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? value : fallback;
}

export const config = {
	nodePort: envInt("NODE_PORT", 5050),
	mediaHost: env("MEDIA_HOST", "127.0.0.1"),
	mediaPort: 8889,
	captureSource: env("CAPTURE_SOURCE", "test"),
	picoSerial: env("PICO_SERIAL"),
} as const;
