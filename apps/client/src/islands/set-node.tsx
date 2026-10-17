import { useSignal } from "@preact/signals";
import { Cookies, Slick } from "@webtools/slick-client";

import { healthStatus } from "../utils/authorization.ts";

type Props = {
	locked: boolean;
	initialUrl: string;
	initialPassword: string;
};

export default function SetNode({ locked, initialUrl, initialPassword }: Props) {
	const url = useSignal(initialUrl || "http://localhost:5050");
	const password = useSignal(initialPassword);
	const error = useSignal<string | null>(null);
	const pending = useSignal(false);

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

		const secret = password.value.trim();
		const status = await healthStatus(origin, secret);
		pending.value = false;
		if (status === 401) {
			error.value = "Wrong password.";
			return;
		}
		if (status !== 200) {
			error.value = "Could not reach the node.";
			return;
		}

		Cookies.set("nodeUrl", origin);
		if (secret) Cookies.set("nodePassword", secret);
		else Cookies.delete("nodePassword");
		await Slick.redirect("/");
	}

	return (
		<article>
			<p className="brand">
				<span>s2</span>pipe
			</p>
			<h1>Connect the node</h1>
			<p>
				{locked
					? "This browser uses the node address from the launcher. Enter the node password if one is set. It is saved in a cookie."
					: "Public URL of the machine running the node, and its password when one is set. Both are saved in a cookie on this browser."}
			</p>
			<form onSubmit={onSubmit}>
				<label className="field">
					<span>Node URL</span>
					<input
						type="url"
						required
						readOnly={locked}
						spellcheck={false}
						autocomplete="url"
						inputMode="url"
						placeholder="http://localhost:5050"
						value={url}
						onInput={(event) => url.value = (event.target as HTMLInputElement).value}
					/>
				</label>
				<label className="field">
					<span>Node password</span>
					<input
						type="password"
						spellcheck={false}
						autocomplete="current-password"
						placeholder="Leave empty if the node has none"
						value={password}
						onInput={(event) => password.value = (event.target as HTMLInputElement).value}
					/>
				</label>
				{error.value && <p className="error">{error.value}</p>}
				<button type="submit" className="btn btn-primary" disabled={pending.value}>
					{pending.value ? "Checking..." : "Test and save"}
				</button>
			</form>
		</article>
	);
}
