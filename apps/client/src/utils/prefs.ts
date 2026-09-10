const KEY = "s2pipe.play";

export type PlayPrefs = {
	volume: number;
	muted: boolean;
	fill: boolean;
	showStats: boolean;
};

const defaults: PlayPrefs = {
	volume: 1,
	muted: false,
	fill: false,
	showStats: false,
};

function storage(): Storage | null {
	try {
		if (typeof document === "undefined") return null;
		return globalThis.localStorage;
	} catch {
		return null;
	}
}

function clampVolume(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return defaults.volume;
	return Math.min(1, Math.max(0, n));
}

export function loadPlayPrefs(): PlayPrefs {
	try {
		const raw = storage()?.getItem(KEY);
		if (!raw) return { ...defaults };
		const parsed = JSON.parse(raw) as Partial<PlayPrefs>;
		return {
			volume: clampVolume(parsed.volume),
			muted: Boolean(parsed.muted),
			fill: Boolean(parsed.fill),
			showStats: Boolean(parsed.showStats),
		};
	} catch {
		return { ...defaults };
	}
}

export function savePlayPrefs(prefs: PlayPrefs): void {
	try {
		storage()?.setItem(
			KEY,
			JSON.stringify({
				volume: clampVolume(prefs.volume),
				muted: Boolean(prefs.muted),
				fill: Boolean(prefs.fill),
				showStats: Boolean(prefs.showStats),
			}),
		);
	} catch {
		// ignore quota / private mode
	}
}
