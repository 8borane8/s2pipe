import type { PadState } from "@s2pipe/shared/types/pad";

import type { Bindings } from "../bindings.ts";

export type VirtualBackend = {
	attach(): void;
	detach(): void;
	sample(bindings: Bindings, mouseSensitivity: number): PadState;
};
