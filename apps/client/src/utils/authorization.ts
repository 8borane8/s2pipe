import { Cookies } from "@webtools/slick-client";

export function nodeUrl(): string {
	return Deno.env.get("NODE_BASE_URL")?.replace(/\/+$/, "") ?? "";
}

export function nodePassword(): string {
	return Cookies.get("nodePassword")?.trim() ?? "";
}

export function authorization(secret?: string | null): Record<string, string> {
	const value = secret?.trim();
	return value ? { authorization: value } : {};
}

export async function healthStatus(url: string, secret?: string | null): Promise<number | null> {
	if (!url) return null;
	try {
		const response = await fetch(`${url}/health`, { headers: authorization(secret) });
		return response.status;
	} catch {
		return null;
	}
}
