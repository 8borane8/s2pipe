import { type Bindings, cloneBindings, sanitizeBindings } from "./bindings.ts";
import { BUILTIN_LABELS, type BuiltinId, type ControllerPreset, factoryPresets, isBuiltinId } from "./presets.ts";

const LAYOUT_VERSION = 2;

type VirtualLayout = {
	version: number;
	activeId: string;
	presets: ControllerPreset[];
	mouseSensitivity: number;
};

export type VirtualPrefs = VirtualLayout & {
	enabled: boolean;
};

export const VIRTUAL_PREFS_KEY = "s2pipe.virtual";
export const MAX_PRESETS = 16;
const MAX_NAME = 32;

const defaults: VirtualLayout = {
	version: LAYOUT_VERSION,
	activeId: "standard",
	presets: factoryPresets(),
	mouseSensitivity: 0.45,
};

function storage(): { getItem(key: string): string | null; setItem(key: string, value: string): void } | null {
	try {
		const host = globalThis as {
			localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
		};
		return host.localStorage ?? null;
	} catch {
		return null;
	}
}

function clampSensitivity(value: unknown): number {
	const n = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(n)) return defaults.mouseSensitivity;
	return Math.min(2, Math.max(0.05, n));
}

export function clampPresetName(value: unknown, fallback = "Profil"): string {
	const name = typeof value === "string" ? value.trim() : "";
	const next = name || fallback;
	return next.slice(0, MAX_NAME);
}

function readPreset(raw: unknown): ControllerPreset | null {
	if (!raw || typeof raw !== "object") return null;
	const item = raw as Partial<ControllerPreset>;
	if (typeof item.id !== "string" || item.id.length === 0 || item.id.length > 80) return null;
	const builtin: BuiltinId | null = isBuiltinId(item.id) ? item.id : null;
	return {
		id: item.id,
		name: builtin ? BUILTIN_LABELS[builtin] : clampPresetName(item.name),
		bindings: sanitizeBindings(item.bindings),
		builtin,
	};
}

function withBuiltins(presets: ControllerPreset[]): ControllerPreset[] {
	const extras = new Map<string, ControllerPreset>();
	const edited = new Map<string, ControllerPreset>();
	for (const preset of presets) {
		if (isBuiltinId(preset.id)) {
			edited.set(preset.id, { ...preset, builtin: preset.id, name: BUILTIN_LABELS[preset.id] });
		} else if (!extras.has(preset.id)) extras.set(preset.id, { ...preset, builtin: null });
	}
	const next = factoryPresets().map((preset) => edited.get(preset.id) ?? preset);
	for (const preset of extras.values()) {
		if (next.length >= MAX_PRESETS) break;
		next.push(preset);
	}
	return next;
}

function layoutFrom(raw: unknown): VirtualLayout {
	const base = {
		version: LAYOUT_VERSION,
		activeId: defaults.activeId,
		presets: factoryPresets(),
		mouseSensitivity: defaults.mouseSensitivity,
	};
	if (!raw || typeof raw !== "object") return base;
	const parsed = raw as Partial<VirtualLayout> & { presetId?: unknown; custom?: unknown };

	if (Array.isArray(parsed.presets)) {
		let items = parsed.presets.map(readPreset).filter((preset) => preset !== null);
		if (parsed.version !== LAYOUT_VERSION) items = items.filter((preset) => !preset.builtin);
		const presets = withBuiltins(items);
		const activeId = typeof parsed.activeId === "string" && presets.some((preset) => preset.id === parsed.activeId)
			? parsed.activeId
			: "standard";
		return {
			version: LAYOUT_VERSION,
			activeId,
			presets,
			mouseSensitivity: clampSensitivity(parsed.mouseSensitivity),
		};
	}

	const presets = factoryPresets();
	let activeId = "standard";
	if (parsed.presetId === "custom") {
		const custom = readPreset({
			id: "custom",
			name: "Custom",
			bindings: parsed.custom,
			builtin: null,
		});
		if (custom && presets.length < MAX_PRESETS) {
			presets.push(custom);
			activeId = custom.id;
		}
	} else if (typeof parsed.presetId === "string" && isBuiltinId(parsed.presetId)) {
		activeId = parsed.presetId;
	}
	return {
		version: LAYOUT_VERSION,
		activeId,
		presets,
		mouseSensitivity: clampSensitivity(parsed.mouseSensitivity),
	};
}

export function parseStoredPrefs(raw: unknown): VirtualPrefs {
	return { ...layoutFrom(raw), enabled: false };
}

export function loadVirtualPrefs(): VirtualPrefs {
	try {
		const raw = storage()?.getItem(VIRTUAL_PREFS_KEY);
		if (!raw) return defaultVirtualPrefs();
		return parseStoredPrefs(JSON.parse(raw));
	} catch {
		return defaultVirtualPrefs();
	}
}

export function saveVirtualPrefs(prefs: VirtualPrefs): void {
	const layout = layoutFrom(prefs);
	try {
		storage()?.setItem(VIRTUAL_PREFS_KEY, JSON.stringify(layout));
	} catch {
		// ignore quota / private mode
	}
}

export function defaultVirtualPrefs(): VirtualPrefs {
	return {
		enabled: false,
		version: defaults.version,
		activeId: defaults.activeId,
		presets: factoryPresets(),
		mouseSensitivity: defaults.mouseSensitivity,
	};
}

export function createUserPreset(name: string, bindings: Bindings): ControllerPreset {
	const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `preset-${Date.now()}`;
	return {
		id,
		name: clampPresetName(name),
		bindings: cloneBindings(sanitizeBindings(bindings)),
		builtin: null,
	};
}
