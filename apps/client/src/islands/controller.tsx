import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";

import { neutralPad, type PadState, samePad } from "@s2pipe/shared/types/pad";

import ControllerPad from "../components/controller-pad.tsx";
import { holdPage } from "../utils/page-session.ts";
import {
	BUILTIN_LABELS,
	type ButtonInput,
	clampPresetName,
	cloneBindings,
	type ControllerPreset,
	createUserPreset,
	createVirtualPad,
	defaultVirtualPrefs,
	loadVirtualPrefs,
	MAX_PRESETS,
	PAD_BUTTON_LABELS,
	type PadButtonName,
	presetBindings,
	saveVirtualPrefs,
	STICK_LABELS,
	type StickBinding,
	type StickDir,
	type StickId,
	type StickListen,
	type VirtualPad,
	type VirtualPrefs,
	watchKeyLayout,
} from "../utils/virtual/mod.ts";

function activePreset(prefs: VirtualPrefs): ControllerPreset {
	return prefs.presets.find((preset) => preset.id === prefs.activeId) ?? prefs.presets[0];
}

export default function Controller() {
	const prefs = useSignal<VirtualPrefs>(defaultVirtualPrefs());
	const live = useSignal<PadState>(neutralPad());
	const listening = useSignal<PadButtonName | StickListen | null>(null);
	const draftName = useSignal("");
	const persist = useRef(false);
	const dialogRef = useRef<HTMLDialogElement>(null);
	const padRef = useRef<VirtualPad | null>(null);

	useEffect(() => {
		prefs.value = loadVirtualPrefs();
		persist.current = true;
		return watchKeyLayout();
	}, []);

	useEffect(() => {
		if (!persist.current) return;
		saveVirtualPrefs(prefs.value);
	}, [prefs.value]);

	useEffect(() => {
		const pad = createVirtualPad();
		padRef.current = pad;
		pad.attach();
		let frame = 0;
		let alive = true;
		const loop = () => {
			if (!alive) return;
			frame = requestAnimationFrame(loop);
			const state = pad.sample(prefs.value);
			if (!samePad(state, live.value)) live.value = state;
		};
		frame = requestAnimationFrame(loop);
		return holdPage(() => {
			alive = false;
			cancelAnimationFrame(frame);
			padRef.current = null;
			pad.detach();
		});
	}, []);

	useEffect(() => {
		const target = listening.value;
		if (!target) return;
		padRef.current?.hold(true);

		const onKey = (event: KeyboardEvent) => {
			event.preventDefault();
			if (event.repeat || event.type === "keyup") return;
			if (event.code === "Escape") {
				if (typeof target === "object") unbindStickDir(target.id, target.dir);
				else unbindButton(target);
			} else if (typeof target === "object") {
				bindStickDir(target.id, target.dir, event.code);
			} else {
				bindButton(target, { kind: "key", code: event.code });
			}
			listening.value = null;
		};

		const block = (event: Event) => {
			event.preventDefault();
		};

		const onMouse = (event: MouseEvent) => {
			const element = event.target instanceof Element ? event.target : null;
			const control = element?.closest("button, a, select, input, textarea, dialog");
			const selected = element?.closest(".pad-cell[aria-pressed='true']");
			if (event.button === 0 && control && !selected) return;
			event.preventDefault();
			if (event.button !== 0) {
				globalThis.addEventListener("contextmenu", block, { capture: true, once: true });
			}
			if (typeof target === "object" || event.button > 4) return;
			bindButton(target, { kind: "mouse", button: event.button });
			listening.value = null;
		};

		globalThis.addEventListener("keydown", onKey, { capture: true });
		globalThis.addEventListener("keyup", onKey, { capture: true });
		globalThis.addEventListener("mousedown", onMouse, { capture: true });
		globalThis.addEventListener("contextmenu", block, { capture: true });
		return holdPage(() => {
			padRef.current?.hold(false);
			globalThis.removeEventListener("keydown", onKey, { capture: true });
			globalThis.removeEventListener("keyup", onKey, { capture: true });
			globalThis.removeEventListener("mousedown", onMouse, { capture: true });
			globalThis.removeEventListener("contextmenu", block, { capture: true });
		});
	}, [listening.value]);

	function patch(next: VirtualPrefs): void {
		prefs.value = next;
	}

	function replaceActive(next: ControllerPreset): void {
		patch({
			...prefs.value,
			presets: prefs.value.presets.map((preset) => preset.id === next.id ? next : preset),
		});
	}

	function unbindButton(name: PadButtonName): void {
		const preset = activePreset(prefs.value);
		const bindings = cloneBindings(preset.bindings);
		delete bindings.buttons[name];
		replaceActive({ ...preset, bindings });
	}

	function unbindStickDir(id: StickId, dir: StickDir): void {
		const preset = activePreset(prefs.value);
		const bindings = cloneBindings(preset.bindings);
		const current = bindings.sticks[id];
		if (current.kind !== "keys") {
			bindings.sticks[id] = { kind: "none" };
		} else {
			const next = { ...current, [dir]: "" };
			bindings.sticks[id] = next.up || next.down || next.left || next.right ? next : { kind: "none" };
		}
		replaceActive({ ...preset, bindings });
	}

	function bindButton(name: PadButtonName, input: ButtonInput): void {
		const preset = activePreset(prefs.value);
		const bindings = cloneBindings(preset.bindings);
		bindings.buttons[name] = input;
		replaceActive({ ...preset, bindings });
	}

	function bindStickDir(id: StickId, dir: StickDir, code: string): void {
		const preset = activePreset(prefs.value);
		const bindings = cloneBindings(preset.bindings);
		const current = bindings.sticks[id];
		const next = current.kind === "keys"
			? { ...current }
			: { kind: "keys" as const, up: "", down: "", left: "", right: "" };
		next[dir] = code;
		bindings.sticks[id] = next;
		replaceActive({ ...preset, bindings });
	}

	function bindStick(id: StickId, stick: StickBinding): void {
		const preset = activePreset(prefs.value);
		const bindings = cloneBindings(preset.bindings);
		bindings.sticks[id] = stick;
		if (stick.kind === "mouse") {
			const other: StickId = id === "left" ? "right" : "left";
			if (bindings.sticks[other].kind === "mouse") bindings.sticks[other] = { kind: "none" };
		}
		replaceActive({ ...preset, bindings });
		listening.value = null;
	}

	function onPreset(id: string): void {
		listening.value = null;
		const preset = activePreset(prefs.value);
		const presets = preset.builtin
			? prefs.value.presets
			: prefs.value.presets.map((item) =>
				item.id === preset.id ? { ...item, name: clampPresetName(item.name) } : item
			);
		if (!presets.some((item) => item.id === id)) return;
		patch({ ...prefs.value, presets, activeId: id });
	}

	function rename(name: string): void {
		const preset = activePreset(prefs.value);
		if (preset.builtin) return;
		replaceActive({ ...preset, name: name.slice(0, 32) });
	}

	function commitName(): void {
		const preset = activePreset(prefs.value);
		if (preset.builtin) return;
		replaceActive({ ...preset, name: clampPresetName(preset.name) });
	}

	function reset(): void {
		const preset = activePreset(prefs.value);
		if (!preset.builtin) return;
		listening.value = null;
		replaceActive({
			...preset,
			name: BUILTIN_LABELS[preset.builtin],
			bindings: presetBindings(preset.builtin),
		});
	}

	function remove(): void {
		const preset = activePreset(prefs.value);
		if (preset.builtin) return;
		listening.value = null;
		const presets = prefs.value.presets.filter((item) => item.id !== preset.id);
		patch({
			...prefs.value,
			presets,
			activeId: presets[0]?.id ?? "standard",
		});
	}

	function openCreate(): void {
		draftName.value = "";
		dialogRef.current?.showModal();
	}

	function create(event: Event): void {
		event.preventDefault();
		if (prefs.value.presets.length >= MAX_PRESETS) return;
		const source = activePreset(prefs.value);
		const preset = createUserPreset(draftName.value || `${source.name} copy`, source.bindings);
		listening.value = null;
		patch({
			...prefs.value,
			activeId: preset.id,
			presets: [...prefs.value.presets, preset],
		});
		dialogRef.current?.close();
	}

	const preset = activePreset(prefs.value);
	const full = prefs.value.presets.length >= MAX_PRESETS;
	const builtins = prefs.value.presets.filter((item) => item.builtin);
	const profils = prefs.value.presets.filter((item) => !item.builtin);

	return (
		<article>
			<p className="brand">
				<span>s2</span>pipe
			</p>
			<p id="back">
				<a href="/">Back to play</a>
			</p>
			<h1>Virtual controller</h1>
			<p>
				Presets keep their names. Profils are copies you can rename. Click a face, or one stick direction, and
				press the key you want. The center of a stick is the stick click. Esc clears that bind.
			</p>

			<div id="tools">
				<label className="field">
					<span>Layout</span>
					<select
						value={preset.id}
						onChange={(event) => onPreset((event.target as HTMLSelectElement).value)}
					>
						<optgroup label="Presets">
							{builtins.map((item) => (
								<option key={item.id} value={item.id}>
									{item.builtin ? BUILTIN_LABELS[item.builtin] : item.name}
								</option>
							))}
						</optgroup>
						<optgroup label="Profils">
							{profils.length === 0
								? <option value="" disabled>Aucun profil</option>
								: profils.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
						</optgroup>
					</select>
				</label>
				{!preset.builtin && (
					<label className="field">
						<span>Nom</span>
						<input
							type="text"
							maxLength={32}
							value={preset.name}
							placeholder="Mon profil"
							onInput={(event) => rename((event.target as HTMLInputElement).value)}
							onBlur={commitName}
						/>
					</label>
				)}
				<label className="field">
					<span>Mouse sensitivity</span>
					<input
						type="range"
						min="0.05"
						max="2"
						step="0.05"
						value={prefs.value.mouseSensitivity}
						onInput={(event) =>
							patch({
								...prefs.value,
								mouseSensitivity: Number((event.target as HTMLInputElement).value),
							})}
					/>
				</label>
				<div>
					<button type="button" className="btn" disabled={full} onClick={openCreate}>
						Nouveau profil
					</button>
					{preset.builtin
						? (
							<button type="button" className="btn" onClick={reset}>
								Reset
							</button>
						)
						: (
							<button type="button" className="btn" onClick={remove}>
								Delete
							</button>
						)}
				</div>
			</div>

			{listening.value && (
				<p>
					{typeof listening.value === "object"
						? `Press a key for ${STICK_LABELS[listening.value.id]} ${listening.value.dir}. Esc clears it.`
						: `Press a key or any mouse button for ${PAD_BUTTON_LABELS[listening.value]}. Esc clears it.`}
				</p>
			)}

			<ControllerPad
				bindings={preset.bindings}
				live={live.value}
				listening={listening.value}
				onButton={(name) => {
					listening.value = name;
				}}
				onStickDir={(id, dir) => {
					listening.value = { id, dir };
				}}
				onStickMode={(id, mode) => {
					listening.value = null;
					bindStick(id, mode === "mouse" ? { kind: "mouse" } : { kind: "none" });
				}}
			/>

			<dialog ref={dialogRef}>
				<form onSubmit={create}>
					<header>
						<h2>Nouveau profil</h2>
					</header>
					<label className="field">
						<span>Nom</span>
						<input
							type="text"
							maxLength={32}
							placeholder="Mon profil"
							value={draftName.value}
							onInput={(event) => draftName.value = (event.target as HTMLInputElement).value}
						/>
					</label>
					<footer>
						<button type="button" className="btn" onClick={() => dialogRef.current?.close()}>
							Annuler
						</button>
						<button type="submit" className="btn btn-primary">Créer</button>
					</footer>
				</form>
			</dialog>
		</article>
	);
}
