import { usesMouseAxis as stickUsesMouse } from "./bindings.ts";
import { createKeyboardMouseBackend } from "./backends/keyboard-mouse.ts";
import { activeBindings } from "./presets.ts";
import type { VirtualPrefs } from "./store.ts";

export function createVirtualPad() {
	const backend = createKeyboardMouseBackend();

	return {
		attach() {
			backend.attach();
		},

		detach() {
			backend.detach();
		},

		sample(prefs: VirtualPrefs) {
			return backend.sample(activeBindings(prefs.presets, prefs.activeId), prefs.mouseSensitivity);
		},

		usesMouseAxis(prefs: VirtualPrefs): boolean {
			return stickUsesMouse(activeBindings(prefs.presets, prefs.activeId));
		},

		hold(active: boolean) {
			backend.hold(active);
		},

		requestPointerLock(target: Element) {
			backend.requestPointerLock(target);
		},
	};
}

export type VirtualPad = ReturnType<typeof createVirtualPad>;
