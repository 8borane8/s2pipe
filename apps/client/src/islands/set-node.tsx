import { useSignal } from "@preact/signals";
import { Cookies, Slick } from "@webtools/slick-client";
import { useEffect } from "preact/hooks";

import { createClient } from "../client.ts";

export default function SetNode() {
	const url = useSignal("http://localhost:5050");
	const error = useSignal<string | null>(null);
	const pending = useSignal(false);

	useEffect(() => {
		const existing = Cookies.get("nodeUrl");
		if (existing) url.value = existing;
	}, []);

	async function onSubmit(event: Event) {
		event.preventDefault();
		error.value = null;
		pending.value = true;

		const trimmed = url.value.trim();
		let origin: string;
		try {
			origin = new URL(trimmed).origin;
		} catch {
			pending.value = false;
			error.value = "That URL is not valid.";
			return;
		}

		try {
			const health = await createClient(origin).get("/health");
			if (!health.success) throw new Error("health");
		} catch {
			pending.value = false;
			error.value = "Could not reach the node.";
			return;
		}

		pending.value = false;
		Cookies.set("nodeUrl", origin);
		await Slick.redirect("/");
	}

	return (
		<article>
			<p class="brand">
				<span>s2</span>pipe
			</p>
			<h1>Connect the node</h1>
			<p>Public URL of the machine running the node. Saved in a cookie on this browser.</p>
			<form onSubmit={onSubmit}>
				<label class="field">
					<span>Node URL</span>
					<input
						type="url"
						required
						spellcheck={false}
						autocomplete="url"
						inputMode="url"
						placeholder="http://localhost:5050"
						value={url}
						onInput={(event) => url.value = (event.target as HTMLInputElement).value}
					/>
				</label>
				{error.value && <p class="error">{error.value}</p>}
				<button type="submit" class="btn btn-primary" disabled={pending.value}>
					{pending.value ? "Checking..." : "Test and save"}
				</button>
			</form>
		</article>
	);
}
