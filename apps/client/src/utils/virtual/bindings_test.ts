import { PadButton } from "@s2pipe/shared/types/pad";

import { cloneBindings, describeInput, sanitizeBindings } from "./bindings.ts";
import { activeBindings, factoryPresets, isBuiltinId, presetBindings } from "./presets.ts";
import { createUserPreset, parseStoredPrefs } from "./store.ts";

Deno.test("sanitizeBindings drops Escape and a second mouse stick", () => {
	const clean = sanitizeBindings({
		buttons: {
			A: { kind: "key", code: "Escape" },
			B: { kind: "key", code: "Space" },
			X: { kind: "nope" },
		},
		sticks: {
			left: { kind: "mouse" },
			right: { kind: "mouse" },
		},
	});
	if (clean.buttons.A) throw new Error("Escape must not bind");
	if (clean.buttons.B?.kind !== "key" || clean.buttons.B.code !== "Space") throw new Error("Space bind lost");
	if (clean.buttons.X) throw new Error("invalid bind kept");
	if (clean.sticks.left.kind !== "mouse") throw new Error("left mouse lost");
	if (clean.sticks.right.kind !== "none") throw new Error("second mouse stick must be cleared");
});

Deno.test("cloneBindings does not alias nested objects", () => {
	const source = presetBindings("standard");
	const copy = cloneBindings(source);
	copy.buttons.A = { kind: "key", code: "KeyZ" };
	copy.sticks.left = { kind: "none" };
	if (source.buttons.A?.kind !== "key" || source.buttons.A.code !== "Space") {
		throw new Error("clone mutated source buttons");
	}
	if (source.sticks.left.kind !== "keys") throw new Error("clone mutated source stick");
});

Deno.test("activeBindings reads the selected preset", () => {
	const presets = factoryPresets();
	const fighter = activeBindings(presets, "fighter");
	if (fighter.buttons.A?.kind !== "key" || fighter.buttons.A.code !== "KeyL") {
		throw new Error("fighter A should be L");
	}
	const extra = createUserPreset("Mine", presetBindings("racing"));
	const resolved = activeBindings([...presets, extra], extra.id);
	if (resolved.sticks.left.kind !== "keys") throw new Error("user preset should keep racing steer stick");
	if (activeBindings(presets, "missing").buttons.A?.kind !== "key") throw new Error("fallback standard");
});

Deno.test("parseStoredPrefs keeps builtin edits and ignores enabled", () => {
	const standard = presetBindings("standard");
	standard.buttons.A = { kind: "key", code: "KeyZ" };
	const parsed = parseStoredPrefs({
		version: 2,
		enabled: true,
		activeId: "standard",
		mouseSensitivity: 1,
		presets: [
			{ id: "standard", name: "Mario", bindings: standard, builtin: "standard" },
			{ id: "nope", name: "", bindings: {} },
		],
	});
	if (parsed.enabled) throw new Error("enabled must not persist");
	if (parsed.activeId !== "standard") throw new Error("active preset lost");
	if (parsed.presets[0]?.name !== "Standard") throw new Error("builtin name must stay fixed");
	if (parsed.presets[0]?.bindings.buttons.A?.kind !== "key" || parsed.presets[0].bindings.buttons.A.code !== "KeyZ") {
		throw new Error("builtin edit lost");
	}
	if (!parsed.presets.some((preset) => preset.id === "racing")) throw new Error("missing builtin not restored");
	const user = parsed.presets.find((preset) => preset.id === "nope");
	if (!user || user.builtin !== null || user.name !== "Profil") throw new Error("user preset sanitize");
});

Deno.test("parseStoredPrefs migrates the old custom slot", () => {
	const parsed = parseStoredPrefs({
		enabled: true,
		presetId: "custom",
		custom: presetBindings("racing"),
		mouseSensitivity: 0.2,
	});
	if (parsed.enabled) throw new Error("old enabled must not come back");
	if (parsed.activeId !== "custom") throw new Error("custom should stay selected");
	const custom = parsed.presets.find((preset) => preset.id === "custom");
	if (!custom || custom.bindings.buttons.ZR?.kind !== "key" || custom.bindings.buttons.ZR.code !== "KeyE") {
		throw new Error("custom bindings lost");
	}
	if (parsed.presets.filter((preset) => preset.builtin).length !== 4) throw new Error("builtins missing");
});

Deno.test("standard and racing presets", () => {
	const standard = presetBindings("standard");
	if (
		standard.sticks.left.kind !== "keys" || standard.sticks.left.up !== "KeyW" ||
		standard.sticks.left.left !== "KeyA" || standard.sticks.left.down !== "KeyS" ||
		standard.sticks.left.right !== "KeyD"
	) throw new Error("standard left stick is WASD");
	if (standard.sticks.right.kind !== "mouse") throw new Error("standard right stick is mouse");
	const stale = parseStoredPrefs({
		activeId: "standard",
		presets: [{ id: "standard", name: "Standard", bindings: { buttons: { A: { kind: "key", code: "KeyZ" } } } }],
	});
	if (stale.presets[0]?.bindings.buttons.ZL?.kind !== "mouse") throw new Error("old builtin presets must refresh");
	if (standard.buttons.ZL?.kind !== "mouse" || standard.buttons.ZL.button !== 0) throw new Error("ZL is left click");
	if (standard.buttons.ZR?.kind !== "mouse" || standard.buttons.ZR.button !== 2) throw new Error("ZR is right click");
	const racing = presetBindings("racing");
	if (
		racing.sticks.left.kind !== "keys" || racing.sticks.left.left !== "KeyA" || racing.sticks.left.right !== "KeyD"
	) {
		throw new Error("racing steers on A and D");
	}
	if (racing.sticks.left.up !== "KeyW" || racing.sticks.left.down !== "KeyS") throw new Error("racing gas and brake");
	if (racing.buttons.R?.kind !== "key" || racing.buttons.R.code !== "ShiftLeft") throw new Error("R drifts");
	if (describeInput(standard.buttons.ZL) !== "Left click") throw new Error(describeInput(standard.buttons.ZL));
});

Deno.test("isBuiltinId", () => {
	if (!isBuiltinId("standard") || isBuiltinId("custom") || isBuiltinId("nope")) {
		throw new Error("preset id guard");
	}
});

Deno.test("standard Home/Capture stay on H/G", () => {
	const standard = presetBindings("standard");
	if (standard.buttons.Home?.kind !== "key" || standard.buttons.Home.code !== "KeyH") {
		throw new Error("Home");
	}
	if (standard.buttons.Capture?.kind !== "key" || standard.buttons.Capture.code !== "KeyG") {
		throw new Error("Capture");
	}
	if ((PadButton.A & PadButton.B) !== 0) throw new Error("bits overlap");
});
