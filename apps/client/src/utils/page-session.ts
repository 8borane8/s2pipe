import { Slick } from "@webtools/slick-client";

type Hold = {
	path: string;
	stop: () => void;
};

const holds: Hold[] = [];
let armed = false;

function releaseExcept(pathname: string): void {
	for (let index = holds.length - 1; index >= 0; index--) {
		if (holds[index].path === pathname) continue;
		holds.splice(index, 1)[0].stop();
	}
}

function arm(): void {
	if (armed) return;
	armed = true;

	document.addEventListener("click", (event) => {
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		if (!(event.target instanceof Element)) return;
		const link = event.target.closest("a");
		if (!(link instanceof HTMLAnchorElement)) return;
		if (!["", "_self"].includes(link.getAttribute("target") || "")) return;
		const url = new URL(link.href, location.href);
		if (url.origin !== location.origin) return;
		if (url.pathname === location.pathname && url.search === location.search) return;
		releaseExcept(url.pathname);
	}, true);

	globalThis.addEventListener("popstate", () => {
		releaseExcept(location.pathname);
	});

	Slick.addOnloadListener(() => {
		releaseExcept(location.pathname);
	});
}

export function holdPage(stop: () => void): () => void {
	arm();
	let ran = false;
	const hold: Hold = {
		path: location.pathname,
		stop: () => {
			if (ran) return;
			ran = true;
			const index = holds.indexOf(hold);
			if (index >= 0) holds.splice(index, 1);
			stop();
		},
	};
	holds.push(hold);
	return hold.stop;
}
