import { type Bindings, cloneBindings, emptyBindings, STICK_PRESETS } from "./bindings.ts";
import type { PadButtonName } from "./targets.ts";

export const BUILTIN_IDS = ["standard", "racing", "platformer", "fighter"] as const;

export type BuiltinId = typeof BUILTIN_IDS[number];

export const BUILTIN_LABELS: Record<BuiltinId, string> = {
	standard: "Standard",
	racing: "Racing",
	platformer: "Platformer",
	fighter: "Fighter",
};

export type ControllerPreset = {
	id: string;
	name: string;
	bindings: Bindings;
	builtin: BuiltinId | null;
};

function buttons(map: Partial<Record<PadButtonName, Bindings["buttons"][PadButtonName]>>): Bindings {
	const next = emptyBindings();
	next.buttons = { ...map };
	return next;
}

const MENU = {
	Plus: { kind: "key", code: "Enter" },
	Minus: { kind: "key", code: "Backspace" },
	Up: { kind: "key", code: "ArrowUp" },
	Down: { kind: "key", code: "ArrowDown" },
	Left: { kind: "key", code: "ArrowLeft" },
	Right: { kind: "key", code: "ArrowRight" },
	Home: { kind: "key", code: "KeyH" },
	Capture: { kind: "key", code: "KeyG" },
} as const;

const PRESETS: Record<BuiltinId, Bindings> = {
	standard: (() => {
		const next = buttons({
			...MENU,
			A: { kind: "key", code: "Space" },
			B: { kind: "key", code: "ControlLeft" },
			X: { kind: "key", code: "ShiftLeft" },
			Y: { kind: "key", code: "KeyF" },
			L: { kind: "key", code: "KeyQ" },
			R: { kind: "key", code: "KeyE" },
			ZL: { kind: "mouse", button: 0 },
			ZR: { kind: "mouse", button: 2 },
			LStick: { kind: "key", code: "AltLeft" },
			RStick: { kind: "mouse", button: 1 },
		});
		next.sticks.left = STICK_PRESETS.wasd;
		next.sticks.right = STICK_PRESETS.mouse;
		return next;
	})(),
	racing: (() => {
		const next = buttons({
			...MENU,
			A: { kind: "key", code: "Space" },
			B: { kind: "key", code: "ControlLeft" },
			X: { kind: "key", code: "KeyR" },
			Y: { kind: "key", code: "KeyC" },
			L: { kind: "key", code: "KeyQ" },
			R: { kind: "key", code: "ShiftLeft" },
			ZL: { kind: "key", code: "KeyF" },
			ZR: { kind: "key", code: "KeyE" },
			LStick: { kind: "key", code: "KeyV" },
		});
		next.sticks.left = STICK_PRESETS.wasd;
		next.sticks.right = STICK_PRESETS.mouse;
		return next;
	})(),
	platformer: (() => {
		const next = buttons({
			...MENU,
			A: { kind: "key", code: "Space" },
			B: { kind: "key", code: "ShiftLeft" },
			X: { kind: "mouse", button: 0 },
			Y: { kind: "key", code: "KeyE" },
			L: { kind: "key", code: "KeyC" },
			R: { kind: "key", code: "KeyF" },
			ZL: { kind: "key", code: "KeyQ" },
			ZR: { kind: "mouse", button: 2 },
			LStick: { kind: "key", code: "ControlLeft" },
			RStick: { kind: "key", code: "KeyV" },
		});
		next.sticks.left = STICK_PRESETS.wasd;
		next.sticks.right = STICK_PRESETS.mouse;
		return next;
	})(),
	fighter: (() => {
		const next = buttons({
			...MENU,
			X: { kind: "key", code: "KeyI" },
			Y: { kind: "key", code: "KeyJ" },
			A: { kind: "key", code: "KeyL" },
			B: { kind: "key", code: "KeyK" },
			L: { kind: "key", code: "KeyQ" },
			R: { kind: "key", code: "KeyE" },
			ZL: { kind: "key", code: "KeyU" },
			ZR: { kind: "key", code: "KeyO" },
			LStick: { kind: "key", code: "Space" },
		});
		next.sticks.left = STICK_PRESETS.wasd;
		return next;
	})(),
};

export function isBuiltinId(id: string): id is BuiltinId {
	return (BUILTIN_IDS as readonly string[]).includes(id);
}

export function presetBindings(id: BuiltinId): Bindings {
	return cloneBindings(PRESETS[id]);
}

export function factoryPresets(): ControllerPreset[] {
	return BUILTIN_IDS.map((id) => ({
		id,
		name: BUILTIN_LABELS[id],
		bindings: presetBindings(id),
		builtin: id,
	}));
}

export function activeBindings(presets: ControllerPreset[], activeId: string): Bindings {
	const found = presets.find((preset) => preset.id === activeId);
	if (!found) return presetBindings("standard");
	return found.bindings;
}
