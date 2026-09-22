import { signal } from "@preact/signals";

import { PAD_BUTTON_NAMES, type PadButtonName, type StickId } from "./targets.ts";

export type ButtonInput =
	| { kind: "key"; code: string }
	| { kind: "mouse"; button: number };

export type StickBinding =
	| { kind: "none" }
	| { kind: "keys"; up: string; down: string; left: string; right: string }
	| { kind: "mouse" };

export type Bindings = {
	buttons: Partial<Record<PadButtonName, ButtonInput>>;
	sticks: Record<StickId, StickBinding>;
};

const RESERVED_CODES = new Set(["Escape"]);

export function emptyBindings(): Bindings {
	return {
		buttons: {},
		sticks: { left: { kind: "none" }, right: { kind: "none" } },
	};
}

export function cloneBindings(bindings: Bindings): Bindings {
	return {
		buttons: { ...bindings.buttons },
		sticks: {
			left: { ...bindings.sticks.left },
			right: { ...bindings.sticks.right },
		},
	};
}

function isButtonInput(value: unknown): value is ButtonInput {
	if (!value || typeof value !== "object") return false;
	const item = value as ButtonInput;
	if (item.kind === "key") return typeof item.code === "string" && item.code.length > 0;
	if (item.kind === "mouse") {
		return Number.isInteger(item.button) && item.button >= 0 && item.button <= 4;
	}
	return false;
}

function isStickBinding(value: unknown): value is StickBinding {
	if (!value || typeof value !== "object") return false;
	const item = value as StickBinding;
	if (item.kind === "none" || item.kind === "mouse") return true;
	if (item.kind !== "keys") return false;
	return [item.up, item.down, item.left, item.right].every((code) => typeof code === "string");
}

function cleanStickCode(code: string): string {
	if (!code || RESERVED_CODES.has(code)) return "";
	return code;
}

export function sanitizeBindings(raw: unknown): Bindings {
	const next = emptyBindings();
	if (!raw || typeof raw !== "object") return next;
	const source = raw as Partial<Bindings>;
	if (source.buttons && typeof source.buttons === "object") {
		for (const name of PAD_BUTTON_NAMES) {
			const input = source.buttons[name];
			if (!isButtonInput(input)) continue;
			if (input.kind === "key" && RESERVED_CODES.has(input.code)) continue;
			next.buttons[name] = input.kind === "key" ? { kind: "key", code: input.code } : {
				kind: "mouse",
				button: input.button,
			};
		}
	}
	if (isStickBinding(source.sticks?.left)) {
		next.sticks.left = source.sticks.left.kind === "keys"
			? {
				kind: "keys",
				up: cleanStickCode(source.sticks.left.up),
				down: cleanStickCode(source.sticks.left.down),
				left: cleanStickCode(source.sticks.left.left),
				right: cleanStickCode(source.sticks.left.right),
			}
			: { ...source.sticks.left };
	}
	if (isStickBinding(source.sticks?.right)) {
		next.sticks.right = source.sticks.right.kind === "keys"
			? {
				kind: "keys",
				up: cleanStickCode(source.sticks.right.up),
				down: cleanStickCode(source.sticks.right.down),
				left: cleanStickCode(source.sticks.right.left),
				right: cleanStickCode(source.sticks.right.right),
			}
			: { ...source.sticks.right };
	}
	if (next.sticks.left.kind === "mouse" && next.sticks.right.kind === "mouse") {
		next.sticks.right = { kind: "none" };
	}
	return next;
}

export function usesMouseAxis(bindings: Bindings): boolean {
	return bindings.sticks.left.kind === "mouse" || bindings.sticks.right.kind === "mouse";
}

const MOUSE_LABELS = ["Left click", "Middle click", "Right click", "Mouse 4", "Mouse 5"];

const layout = signal<ReadonlyMap<string, string> | null>(null);

const AZERTY: Record<string, string> = {
	Backquote: "²",
	Digit1: "&",
	Digit2: "é",
	Digit3: '"',
	Digit4: "'",
	Digit5: "(",
	Digit6: "-",
	Digit7: "è",
	Digit8: "_",
	Digit9: "ç",
	Digit0: "à",
	Minus: ")",
	Equal: "=",
	KeyQ: "a",
	KeyW: "z",
	KeyA: "q",
	KeyZ: "w",
	KeyM: ",",
	BracketLeft: "^",
	BracketRight: "$",
	Semicolon: "m",
	Quote: "ù",
	Backslash: "*",
	IntlBackslash: "<",
	Comma: ";",
	Period: ":",
	Slash: "!",
};

type LayoutKeyboard = {
	getLayoutMap?: () => Promise<ReadonlyMap<string, string>>;
	addEventListener?: (type: "layoutchange", listener: () => void) => void;
	removeEventListener?: (type: "layoutchange", listener: () => void) => void;
};

function keyboardApi(): LayoutKeyboard | null {
	if (typeof navigator === "undefined") return null;
	const nav = navigator as Navigator & { keyboard?: LayoutKeyboard };
	return nav.keyboard ?? null;
}

function fallbackLayout(): ReadonlyMap<string, string> | null {
	const lang = navigator.language?.toLowerCase() ?? "";
	if (!lang.startsWith("fr")) return null;
	return new Map(Object.entries(AZERTY));
}

export function watchKeyLayout(): () => void {
	const keyboard = keyboardApi();
	let dead = false;
	const apply = (map: ReadonlyMap<string, string> | null) => {
		if (!dead) layout.value = map;
	};
	const load = () => {
		if (keyboard?.getLayoutMap) {
			keyboard.getLayoutMap().then(apply).catch(() => apply(fallbackLayout()));
			return;
		}
		apply(fallbackLayout());
	};
	load();
	keyboard?.addEventListener?.("layoutchange", load);
	return () => {
		dead = true;
		keyboard?.removeEventListener?.("layoutchange", load);
	};
}

function prettyCode(code: string): string {
	const named: Record<string, string> = {
		Space: "Space",
		Enter: "Enter",
		Backspace: "Backspace",
		Tab: "Tab",
		ShiftLeft: "Left Shift",
		ShiftRight: "Right Shift",
		ControlLeft: "Left Ctrl",
		ControlRight: "Right Ctrl",
		AltLeft: "Left Alt",
		AltRight: "Right Alt",
		MetaLeft: "Left Meta",
		MetaRight: "Right Meta",
		ArrowUp: "Up",
		ArrowDown: "Down",
		ArrowLeft: "Left",
		ArrowRight: "Right",
	};
	if (named[code]) return named[code];
	if (code.startsWith("Key") && code.length === 4) return code.slice(3);
	if (code.startsWith("Digit") && code.length === 6) return code.slice(5);
	return code;
}

function keyLegend(code: string): string {
	if (!code) return "";
	const raw = layout.value?.get(code);
	if (raw && raw.trim() && !/^(Space|Enter|Tab|Shift|Control|Alt|Meta|Arrow)/.test(code)) {
		return /^[a-z]$/i.test(raw) ? raw.toLocaleUpperCase("fr") : raw;
	}
	return prettyCode(code);
}

export function describeInput(input: ButtonInput | undefined): string {
	if (!input) return "Unbound";
	if (input.kind === "mouse") return MOUSE_LABELS[input.button] ?? `Mouse ${input.button}`;
	return keyLegend(input.code);
}

export function describeStickDir(binding: StickBinding, dir: "up" | "down" | "left" | "right"): string {
	if (binding.kind === "mouse") return "Mouse";
	if (binding.kind !== "keys" || !binding[dir]) return "Off";
	return keyLegend(binding[dir]);
}

export const STICK_PRESETS = {
	wasd: { kind: "keys", up: "KeyW", down: "KeyS", left: "KeyA", right: "KeyD" },
	mouse: { kind: "mouse" },
} as const satisfies Record<string, StickBinding>;
