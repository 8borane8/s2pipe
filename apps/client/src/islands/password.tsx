import { useSignal } from "@preact/signals";
import { Cookies, Slick } from "@webtools/slick-client";

import { healthStatus } from "../utils/authorization.ts";

type Props = {
	nodeUrl: string;
};

export default function Password({ nodeUrl }: Props) {
	const password = useSignal("");
	const error = useSignal<string | null>(null);
	const pending = useSignal(false);

	async function onSubmit(event: Event) {
		event.preventDefault();
		error.value = null;
		pending.value = true;

		const secret = password.value.trim();
		const status = await healthStatus(nodeUrl, secret);
		pending.value = false;
		if (status === 401) {
			error.value = "Wrong password.";
			return;
		}
		if (status !== 200) {
			error.value = "Could not reach the node.";
			return;
		}

		Cookies.set("nodePassword", secret);
		await Slick.redirect("/");
	}

	return (
		<article>
			<p className="brand">
				<span>s2</span>pipe
			</p>
			<h1>Node password</h1>
			<p>The node refused the connection. Enter its password. It is saved in a cookie on this browser.</p>
			<form onSubmit={onSubmit}>
				<label className="field">
					<span>Password</span>
					<input
						type="password"
						required
						spellcheck={false}
						autocomplete="current-password"
						value={password}
						onInput={(event) => password.value = (event.target as HTMLInputElement).value}
					/>
				</label>
				{error.value && <p className="error">{error.value}</p>}
				<button type="submit" className="btn btn-primary" disabled={pending.value}>
					{pending.value ? "Checking..." : "Continue"}
				</button>
			</form>
		</article>
	);
}
