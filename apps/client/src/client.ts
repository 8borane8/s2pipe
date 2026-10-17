export function nodeUrlLocked(): boolean {
	return Boolean(Deno.env.get("NODE_BASE_URL"));
}

export function nodeUrl(cookie?: string | null): string | undefined {
	const raw = Deno.env.get("NODE_BASE_URL") || cookie;
	return raw?.replace(/\/+$/, "") || undefined;
}
