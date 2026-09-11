import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Gamepad2, Maximize, Minimize, Settings, Volume2, VolumeX, X } from "lucide-preact";

import type { CaptureStatus, ClientMessage, PicoStatus, ServerMessage } from "@s2pipe/shared/types/node";
import { neutralPad, PAD_COUNT, type PadState, samePad } from "@s2pipe/shared/types/pad";

import { createInputTracker, type GamepadOption, listGamepads } from "../utils/input.ts";
import {
	type AudioWhepHandle,
	onWhepDead,
	readStreamStats,
	startAudioWhep,
	startWhep,
	type StreamStats,
	type WhepHandle,
} from "../utils/whep.ts";
import { loadPlayPrefs, savePlayPrefs } from "../utils/prefs.ts";

type Props = {
	nodeUrl: string;
	nodeLocked: boolean;
};

type Toast = { id: number; text: string };

function wsUrl(nodeUrl: string): string {
	const url = new URL(nodeUrl);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = "/socket";
	url.search = "";
	return url.href;
}

function send(ws: WebSocket | null, message: ClientMessage): void {
	if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
}

function picoTitle(pico: PicoStatus | null): string | undefined {
	if (!pico) return undefined;
	if (pico.error) return pico.error;
	const parts: string[] = [];
	if (pico.path) parts.push(pico.path);
	if (pico.connected && !pico.wake) parts.push("Sleep wake: set SWITCH_BT_MAC and CONTROLLER_BT_MAC");
	return parts.length ? parts.join("\n") : undefined;
}

function padLabel(id: string): string {
	const name = id.split("(")[0]?.trim();
	return name || id;
}

const NEUTRAL = neutralPad();

function sameIds(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i]);
}

function selectedPads(pads: GamepadOption[], chosen: number[]): GamepadOption[] {
	return pads.filter((pad) => chosen.includes(pad.index));
}

function streamBanner(
	connected: boolean,
	capture: CaptureStatus | null,
	live: boolean,
): { title: string; body: string } | null {
	if (!connected) {
		return { title: "Connecting", body: "Waiting for the node..." };
	}
	if (capture && !capture.running) {
		return {
			title: "Capture is down",
			body: "MediaMTX is unreachable. The capture PC may be restarting.",
		};
	}
	if (!live) {
		return { title: "Waiting for stream", body: "Connecting to the capture card..." };
	}
	return null;
}

export default function Play({ nodeUrl, nodeLocked }: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const stageRef = useRef<HTMLElement>(null);
	const whepRef = useRef<WhepHandle | null>(null);
	const audioRef = useRef<AudioWhepHandle | null>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const inputRef = useRef<ReturnType<typeof createInputTracker> | null>(null);
	const statsPrev = useRef<{ bytes: number; at: number } | null>(null);
	const toastSeq = useRef(0);
	const pendingPlays = useRef(0);
	const persistPrefs = useRef(false);

	const connected = useSignal(false);
	const capture = useSignal<CaptureStatus | null>(null);
	const pico = useSignal<PicoStatus | null>(null);
	const pads = useSignal<GamepadOption[]>([]);
	const chosen = useSignal<number[]>([]);
	const seats = useSignal<number[]>([]);
	const occupied = useSignal<number[]>([]);
	const livePads = useSignal<number[]>([]);
	const settings = useSignal(false);
	const muted = useSignal(false);
	const volume = useSignal(1);
	const fill = useSignal(false);
	const showStats = useSignal(false);
	const stats = useSignal<StreamStats | null>(null);
	const fullscreen = useSignal(false);
	const live = useSignal(false);
	const toasts = useSignal<Toast[]>([]);

	useEffect(() => {
		const prefs = loadPlayPrefs();
		muted.value = prefs.muted;
		volume.value = prefs.volume;
		fill.value = prefs.fill;
		showStats.value = prefs.showStats;
	}, []);

	useEffect(() => {
		if (!persistPrefs.current) {
			persistPrefs.current = true;
			return;
		}
		savePlayPrefs({
			muted: muted.value,
			volume: volume.value,
			fill: fill.value,
			showStats: showStats.value,
		});
	}, [muted.value, volume.value, fill.value, showStats.value]);

	function toast(text: string): void {
		const id = ++toastSeq.current;
		toasts.value = [...toasts.value, { id, text }];
		setTimeout(() => {
			toasts.value = toasts.value.filter((item) => item.id !== id);
		}, 4200);
	}

	// Gestion de la connexion WHeP (Vidéo + Audio)
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;
		let cancelled = false;
		let videoHandle: WhepHandle | null = null;
		let audioHandle: AudioWhepHandle | null = null;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		let iceHinted = false;

		const cleanupWhep = () => {
			void videoHandle?.close();
			void audioHandle?.close();
			videoHandle = null;
			audioHandle = null;
			whepRef.current = null;
			audioRef.current = null;
		};

		const connect = async () => {
			try {
				videoHandle = await startWhep(nodeUrl, video);
				whepRef.current = videoHandle;
				live.value = true;

				onWhepDead(videoHandle.pc, (hadMedia) => {
					if (!hadMedia && !iceHinted) {
						iceHinted = true;
						toast("ICE failed. Set MEDIA_ICE_IP to this machine's LAN address, not 127.0.0.1.");
					}
					if (!cancelled) {
						live.value = false;
						cleanupWhep();
						retryTimer = globalThis.setTimeout(connect, hadMedia ? 1500 : 2000);
					}
				});
			} catch {
				if (!cancelled) {
					retryTimer = globalThis.setTimeout(connect, 2000);
				}
				return;
			}

			try {
				audioHandle = await startAudioWhep(nodeUrl);
				if (audioHandle) {
					audioRef.current = audioHandle;
					audioHandle.audio.muted = muted.value;
					audioHandle.audio.volume = volume.value;
				}
			} catch {
				// L'audio peut échouer sans bloquer la vidéo
			}
		};

		void connect();

		return () => {
			cancelled = true;
			clearTimeout(retryTimer);
			cleanupWhep();
		};
	}, [nodeUrl]);

	useEffect(() => {
		// deno-lint-ignore no-explicit-any
		const video = videoRef.current as any;
		if (!video) return;
		const onEnd = () => {
			fullscreen.value = false;
		};
		const onBegin = () => {
			fullscreen.value = true;
			settings.value = false;
		};
		video.addEventListener("webkitendfullscreen", onEnd);
		video.addEventListener("webkitbeginfullscreen", onBegin);
		return () => {
			video.removeEventListener("webkitendfullscreen", onEnd);
			video.removeEventListener("webkitbeginfullscreen", onBegin);
		};
	}, []);

	// Gestion WebSocket (Statut et Commandes)
	useEffect(() => {
		let socket: WebSocket | null = null;
		let retryTimer: ReturnType<typeof setTimeout> | undefined;
		let isClosed = false;

		function connectWs() {
			if (isClosed) return;
			socket = new WebSocket(wsUrl(nodeUrl));
			wsRef.current = socket;

			socket.addEventListener("open", () => {
				connected.value = true;
				const count = chosen.value.length;
				if (!count) return;
				pendingPlays.current += 1;
				send(socket, { op: "play", data: { count } });
			});

			socket.addEventListener("message", (event) => {
				if (typeof event.data !== "string") return;
				try {
					const msg = JSON.parse(event.data) as ServerMessage;
					if (msg.op === "play") {
						pendingPlays.current = Math.max(0, pendingPlays.current - 1);
						const granted = msg.data.seats;
						seats.value = granted;
						if (pendingPlays.current > 0) return;
						const selected = selectedPads(pads.value, chosen.value);
						if (granted.length >= selected.length) return;
						chosen.value = selected.slice(0, granted.length).map((pad) => pad.index);
						toast(granted.length ? "Not enough remote pads." : "All remote pads are taken.");
					} else if (msg.op === "status") {
						capture.value = msg.data.capture;
						if (!msg.data.capture.running) live.value = false;
						pico.value = msg.data.pico;
						occupied.value = msg.data.occupied;
					} else if (msg.op === "ping") {
						send(socket, { op: "pong" });
					}
				} catch {
					// Ignorer les messages invalides
				}
			});

			socket.addEventListener("close", () => {
				wsRef.current = null;
				pendingPlays.current = 0;
				seats.value = [];
				connected.value = false;
				if (!isClosed) {
					retryTimer = globalThis.setTimeout(connectWs, 1500);
				}
			});
		}

		connectWs();

		return () => {
			isClosed = true;
			clearTimeout(retryTimer);
			socket?.close();
			wsRef.current = null;
		};
	}, [nodeUrl]);

	// Gestion des manettes (Gamepads)
	useEffect(() => {
		const tracker = createInputTracker();
		inputRef.current = tracker;
		tracker.attach();

		const updatePads = () => {
			const next = listGamepads();
			const still = chosen.value.filter((index) => next.some((pad) => pad.index === index));
			const lost = still.length !== chosen.value.length;
			pads.value = next;
			chosen.value = still;
			if (lost) syncSeats(still.length);
		};

		updatePads();
		globalThis.addEventListener("gamepadconnected", updatePads);
		globalThis.addEventListener("gamepaddisconnected", updatePads);

		return () => {
			tracker.detach();
			inputRef.current = null;
			globalThis.removeEventListener("gamepadconnected", updatePads);
			globalThis.removeEventListener("gamepaddisconnected", updatePads);
		};
	}, []);

	// Boucle d'envoi des inputs de la manette
	useEffect(() => {
		let frame = 0;
		const lastBySeat = new Map<number, PadState>();
		let lastAssignedKey = "";

		const loop = () => {
			frame = requestAnimationFrame(loop);
			const tracker = inputRef.current;
			if (!tracker) return;

			const sampled = new Map<number, PadState>();
			const active: number[] = [];
			for (const pad of pads.value) {
				const state = tracker.sample(pad.index, false);
				sampled.set(pad.index, state);
				if (!samePad(state, NEUTRAL)) active.push(pad.index);
			}
			if (!sameIds(active, livePads.value)) livePads.value = active;

			const ws = wsRef.current;
			const assigned = seats.value;
			const assignedKey = assigned.join(",");
			if (!ws || ws.readyState !== WebSocket.OPEN || !assigned.length) {
				if (lastAssignedKey) {
					lastBySeat.clear();
					lastAssignedKey = "";
				}
				return;
			}

			if (assignedKey !== lastAssignedKey) {
				lastBySeat.clear();
				lastAssignedKey = assignedKey;
			}

			const selected = selectedPads(pads.value, chosen.value);

			for (let i = 0; i < assigned.length; i++) {
				const seat = assigned[i]!;
				const pad = selected[i];
				const state = i === 0
					? tracker.sample(pad ? pad.index : null, true)
					: pad
					? sampled.get(pad.index) ?? NEUTRAL
					: NEUTRAL;
				const previous = lastBySeat.get(seat);
				if (previous && samePad(previous, state)) continue;
				lastBySeat.set(seat, state);
				send(ws, { op: "pad", data: state, seat });
			}
		};

		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	}, []);

	// Raccourci Clavier (Échap pour les paramètres)
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.code !== "Escape" || event.repeat) return;
			settings.value = !settings.value;
		};
		globalThis.addEventListener("keydown", onKey);
		return () => globalThis.removeEventListener("keydown", onKey);
	}, []);

	// Synchro Volume / Mute
	useEffect(() => {
		if (videoRef.current) videoRef.current.muted = true;
		const audio = audioRef.current?.audio;
		if (!audio) return;
		audio.muted = muted.value;
		audio.volume = volume.value;
	}, [muted.value, volume.value, live.value]);

	// Récupération des stats du flux
	useEffect(() => {
		if (!showStats.value) {
			stats.value = null;
			return;
		}
		const timer = globalThis.setInterval(() => {
			const pc = whepRef.current?.pc;
			if (!pc) return;
			readStreamStats(pc, statsPrev.current).then((result) => {
				statsPrev.current = result.prev;
				stats.value = result.stats;
			}).catch(() => {});
		}, 1000);
		return () => clearInterval(timer);
	}, [showStats.value]);

	// Gestion Plein Écran
	useEffect(() => {
		const onFs = () => {
			const on = document.fullscreenElement === stageRef.current;
			fullscreen.value = on;
			if (on) settings.value = false;
		};
		document.addEventListener("fullscreenchange", onFs);
		return () => document.removeEventListener("fullscreenchange", onFs);
	}, []);

	function syncSeats(count: number): void {
		const ws = wsRef.current;
		if (!ws || ws.readyState !== WebSocket.OPEN) return;
		if (count > 0) {
			pendingPlays.current += 1;
			send(ws, { op: "play", data: { count } });
			return;
		}
		pendingPlays.current = 0;
		seats.value = [];
		send(ws, { op: "watch" });
	}

	function toggleSeat(index: number): void {
		const claimed = chosen.value.includes(index);
		if (!claimed && occupied.value.length >= PAD_COUNT) return;
		chosen.value = claimed ? chosen.value.filter((item) => item !== index) : [...chosen.value, index];
		syncSeats(chosen.value.length);
	}

	function onStageClick(): void {
		void videoRef.current?.play();
		void audioRef.current?.audio.play();
	}

	function toggleFullscreen(): void {
		// deno-lint-ignore no-explicit-any
		const video = videoRef.current as any;
		if (video?.webkitEnterFullscreen && !document.fullscreenEnabled) {
			video.webkitEnterFullscreen();
			return;
		}
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void stageRef.current?.requestFullscreen();
		}
	}

	const hideHud = fullscreen.value;
	const banner = streamBanner(connected.value, capture.value, live.value);
	const selected = selectedPads(pads.value, chosen.value);
	const seatByIndex = new Map(selected.map((pad, i) => [pad.index, seats.value[i]] as const));

	return (
		<section
			id="play"
			ref={stageRef}
			data-fill={fill.value ? "true" : undefined}
			data-idle={hideHud ? "true" : undefined}
			onClick={onStageClick}
			onDblClick={(event) => {
				event.preventDefault();
				toggleFullscreen();
			}}
		>
			<video
				ref={videoRef}
				autoplay
				muted
				playsInline
				onPlaying={() => {
					live.value = true;
				}}
			/>

			{banner && (
				<div>
					<h2>{banner.title}</h2>
					<p>{banner.body}</p>
				</div>
			)}

			{showStats.value && (
				<dl>
					<div>
						<dt>Bitrate</dt>
						<dd>{stats.value ? `${stats.value.bitrateKbps} kb/s` : "-"}</dd>
					</div>
					<div>
						<dt>FPS</dt>
						<dd>{stats.value ? Math.round(stats.value.fps) : "-"}</dd>
					</div>
					<div>
						<dt>Lost</dt>
						<dd>{stats.value ? stats.value.packetsLost : "-"}</dd>
					</div>
				</dl>
			)}

			<div onClick={(event) => event.stopPropagation()}>
				<div>
					<span className="brand">
						<span>s2</span>pipe
					</span>
					<span>
						<Gamepad2 size={13} aria-hidden="true" />
						<span>
							<strong>{occupied.value.length}</strong>
							<span>/{PAD_COUNT} playing</span>
						</span>
					</span>
					<div>
						<span className="pill" data-ok={capture.value?.running ? "true" : "false"}>
							Capture {capture.value?.running ? "live" : "down"}
						</span>
						<span
							className="pill"
							data-ok={pico.value?.connected ? "true" : "false"}
							title={picoTitle(pico.value)}
						>
							Pico {pico.value?.connected ? "ready" : "off"}
						</span>
						<span className="pill" data-ok={connected.value ? "true" : "false"}>
							{connected.value ? "Connected" : "Connecting"}
						</span>
					</div>
				</div>

				<div>
					{pads.value.length > 0
						? (
							<div>
								{pads.value.map((pad) => {
									const seat = seatByIndex.get(pad.index);
									const claimed = chosen.value.includes(pad.index);
									const full = occupied.value.length >= PAD_COUNT && !claimed;
									const state = seat !== undefined ? "live" : claimed ? "ready" : "off";
									const status = seat !== undefined
										? `P${seat + 1}`
										: claimed
										? "..."
										: full
										? "Full"
										: "Play";
									return (
										<button
											type="button"
											key={pad.index}
											data-state={state}
											data-active={livePads.value.includes(pad.index) ? "true" : undefined}
											disabled={full || !connected.value}
											onClick={() => toggleSeat(pad.index)}
										>
											<span>{padLabel(pad.id)}</span>
											<span>{status}</span>
										</button>
									);
								})}
							</div>
						)
						: <p>Connect a gamepad, then click it to play.</p>}
					<div>
						<button
							type="button"
							className="btn btn-icon"
							aria-label={muted.value ? "Unmute" : "Mute"}
							onClick={() => muted.value = !muted.value}
						>
							{muted.value ? <VolumeX size={16} /> : <Volume2 size={16} />}
						</button>
						<button
							type="button"
							className="btn btn-icon"
							aria-label={fullscreen.value ? "Exit fullscreen" : "Fullscreen"}
							onClick={toggleFullscreen}
						>
							{fullscreen.value ? <Minimize size={16} /> : <Maximize size={16} />}
						</button>
						<button
							type="button"
							className="btn btn-icon"
							aria-label="Settings"
							onClick={() => settings.value = !settings.value}
						>
							<Settings size={16} />
						</button>
					</div>
				</div>
			</div>

			{settings.value && (
				<aside onClick={(event) => event.stopPropagation()}>
					<div>
						<h2>Settings</h2>
						<button
							type="button"
							className="btn btn-icon"
							aria-label="Close settings"
							onClick={() => settings.value = false}
						>
							<X size={16} />
						</button>
					</div>

					<div className="field">
						<span>Node</span>
						<div>
							<p>{nodeUrl}</p>
							{!nodeLocked && <a className="btn" href="/set-node">Modify</a>}
						</div>
					</div>

					<label className="field">
						<span>Volume</span>
						<input
							type="range"
							min="0"
							max="1"
							step="0.05"
							value={volume.value}
							onInput={(event) => {
								volume.value = Number((event.target as HTMLInputElement).value);
								if (volume.value > 0) muted.value = false;
							}}
						/>
					</label>

					<label>
						<input
							type="checkbox"
							checked={fill.value}
							onChange={(event) => fill.value = (event.target as HTMLInputElement).checked}
						/>
						Fill (crop) instead of letterbox
					</label>

					<label>
						<input
							type="checkbox"
							checked={showStats.value}
							onChange={(event) => showStats.value = (event.target as HTMLInputElement).checked}
						/>
						Overlay WebRTC stats
					</label>

					<section>
						<h3>Home</h3>
						<p>
							Home on the Switch is the Xbox Guide / PS button. Capture / Share is Capture. Windows and
							Steam often steal Guide before the browser can send Home.
						</p>
						<p>
							Game Bar: Windows Settings, Gaming, Xbox Game Bar. Turn off "Open Xbox Game Bar using this
							button on a controller".
						</p>
						<p>
							Steam: Steam Settings, Controller. Turn off "Guide button focuses Steam". If a Steam menu
							still opens, disable Steam Input for this pad or quit Steam while you play.
						</p>
						<p>
							Last resort: hold Minus and Plus together (View + Menu, Select + Start, or - and +). That
							sends Home without using Guide.
						</p>
						<dl>
							<div>
								<dt>H / G</dt>
								<dd>Home / Capture</dd>
							</div>
							<div>
								<dt>Esc</dt>
								<dd>Settings</dd>
							</div>
						</dl>
					</section>
				</aside>
			)}

			<ul aria-live="polite">
				{toasts.value.map((item) => <li key={item.id}>{item.text}</li>)}
			</ul>
		</section>
	);
}
