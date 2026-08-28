import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { Eye, Gamepad2, Maximize, Minimize, Settings, Volume2, VolumeX, X } from "lucide-preact";

import type { CaptureStatus, ClientMessage, PicoStatus, ServerMessage } from "@s2pipe/shared/types/node";
import { PAD_COUNT, type PadState, samePad } from "@s2pipe/shared/types/pad";

import {
	createInputTracker,
	type GamepadOption,
	type InputSource,
	KEYBOARD_HELP,
	listGamepads,
} from "../utils/input.ts";
import {
	type AudioWhepHandle,
	onWhepDead,
	readStreamStats,
	startAudioWhep,
	startWhep,
	type StreamStats,
	type WhepHandle,
} from "../utils/whep.ts";

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

function firstPad(list: GamepadOption[]): InputSource | null {
	return list[0] ? { kind: "gamepad", index: list[0].index } : null;
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
	const playRequested = useRef(false);

	const playing = useSignal(false);
	const playingCount = useSignal(0);
	const connected = useSignal(false);
	const capture = useSignal<CaptureStatus | null>(null);
	const pico = useSignal<PicoStatus | null>(null);
	const pads = useSignal<GamepadOption[]>([]);
	const source = useSignal<InputSource | null>(null);
	const settings = useSignal(false);
	const muted = useSignal(false);
	const volume = useSignal(1);
	const fill = useSignal(false);
	const showStats = useSignal(false);
	const stats = useSignal<StreamStats | null>(null);
	const fullscreen = useSignal(false);
	const live = useSignal(false);
	const toasts = useSignal<Toast[]>([]);

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
		let retryTimer = 0;
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

	// Gestion WebSocket (Statut et Commandes)
	useEffect(() => {
		let socket: WebSocket | null = null;
		let retryTimer = 0;
		let isClosed = false;

		function connectWs() {
			if (isClosed) return;
			socket = new WebSocket(wsUrl(nodeUrl));
			wsRef.current = socket;

			socket.addEventListener("open", () => {
				connected.value = true;
			});

			socket.addEventListener("message", (event) => {
				if (typeof event.data !== "string") return;
				try {
					const msg = JSON.parse(event.data) as ServerMessage;
					if (msg.op === "play") {
						if (!playRequested.current) return;
						playRequested.current = false;
						playing.value = msg.data.playing;
						if (!msg.data.playing) toast("All remote pads are taken.");
					} else if (msg.op === "status") {
						capture.value = msg.data.capture;
						if (!msg.data.capture.running) live.value = false;
						pico.value = msg.data.pico;
						playingCount.value = msg.data.playing;
					} else if (msg.op === "ping") {
						send(socket, { op: "pong" });
					}
				} catch {
					// Ignorer les messages invalides
				}
			});

			socket.addEventListener("close", () => {
				wsRef.current = null;
				playRequested.current = false;
				playing.value = false;
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
			pads.value = next;
			const current = source.value;
			if (!current || !next.some((pad) => pad.index === current.index)) {
				source.value = firstPad(next);
			}
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
		if (!playing.value) return;
		let frame = 0;
		let lastState: PadState | null = null;

		const loop = () => {
			frame = requestAnimationFrame(loop);
			const tracker = inputRef.current;
			const ws = wsRef.current;
			const pad = source.value;

			if (!tracker || !pad || !ws || ws.readyState !== WebSocket.OPEN) return;

			const state = tracker.sample(pad);
			if (lastState !== null && samePad(lastState, state)) return;

			lastState = state;
			send(ws, { op: "pad", data: state });
		};

		frame = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(frame);
	}, [playing.value]);

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

	function play(): void {
		if (playing.value || wsRef.current?.readyState !== WebSocket.OPEN) return;
		playRequested.current = true;
		send(wsRef.current, { op: "play" });
	}

	function watch(): void {
		playRequested.current = false;
		playing.value = false;
		send(wsRef.current, { op: "watch" });
	}

	function onStageClick(): void {
		void videoRef.current?.play();
		void audioRef.current?.audio.play();
	}

	function toggleFullscreen(): void {
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void stageRef.current?.requestFullscreen();
		}
	}

	const hideHud = fullscreen.value;
	const padsFull = playingCount.value >= PAD_COUNT && !playing.value;
	const banner = streamBanner(connected.value, capture.value, live.value);

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
				<div class="play-banner">
					<h2>{banner.title}</h2>
					<p>{banner.body}</p>
				</div>
			)}

			{showStats.value && (
				<dl class="play-stats">
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

			<div class="play-hud" onClick={(event) => event.stopPropagation()}>
				<div class="play-top">
					<span class="play-brand">
						<span>s2</span>pipe
					</span>
					<div class="play-slots">
						<span class="play-count">{playingCount.value}/{PAD_COUNT} playing</span>
						<button
							type="button"
							class="play-slot"
							data-state={playing.value ? "you" : "free"}
							disabled={padsFull}
							onClick={play}
						>
							<Gamepad2 size={14} aria-hidden="true" />
							Play
						</button>
						<button
							type="button"
							class="play-slot"
							data-state={!playing.value ? "you" : "free"}
							onClick={watch}
						>
							<Eye size={14} aria-hidden="true" />
							Watch
						</button>
					</div>
					<div class="play-status">
						<span class="pill" data-ok={capture.value?.running ? "true" : "false"}>
							Capture {capture.value?.running ? "live" : "down"}
						</span>
						<span
							class="pill"
							data-ok={pico.value?.connected ? "true" : "false"}
							title={picoTitle(pico.value)}
						>
							Pico {pico.value?.connected ? "ready" : "off"}
						</span>
						<span class="pill" data-ok={connected.value ? "true" : "false"}>
							{connected.value ? "Connected" : "Connecting"}
						</span>
					</div>
				</div>

				<div class="play-bottom">
					<label class="play-controller">
						<select
							aria-label="Controller"
							value={source.value ? String(source.value.index) : ""}
							onChange={(e) => {
								const val = Number((e.target as HTMLSelectElement).value);
								if (Number.isFinite(val)) source.value = { kind: "gamepad", index: val };
							}}
						>
							{pads.value.length === 0 && <option value="" disabled>Connect a gamepad</option>}
							{pads.value.map((pad) => <option value={String(pad.index)}>{pad.id}</option>)}
						</select>
						{connected.value && !playing.value && (
							<span class="play-hint">Click Play, then use a gamepad.</span>
						)}
					</label>
					<div class="play-tools">
						<button
							type="button"
							class="btn btn-icon"
							aria-label={muted.value ? "Unmute" : "Mute"}
							onClick={() => muted.value = !muted.value}
						>
							{muted.value ? <VolumeX size={16} /> : <Volume2 size={16} />}
						</button>
						<button
							type="button"
							class="btn btn-icon"
							aria-label={fullscreen.value ? "Exit fullscreen" : "Fullscreen"}
							onClick={toggleFullscreen}
						>
							{fullscreen.value ? <Minimize size={16} /> : <Maximize size={16} />}
						</button>
						<button
							type="button"
							class="btn btn-icon"
							aria-label="Settings"
							onClick={() => settings.value = !settings.value}
						>
							<Settings size={16} />
						</button>
					</div>
				</div>
			</div>

			{settings.value && (
				<aside class="play-settings" onClick={(event) => event.stopPropagation()}>
					<div>
						<h2>Settings</h2>
						<button
							type="button"
							class="btn btn-icon"
							aria-label="Close settings"
							onClick={() => settings.value = false}
						>
							<X size={16} />
						</button>
					</div>

					<div class="field">
						<span>Node</span>
						<div class="play-node">
							<p>{nodeUrl}</p>
							{!nodeLocked && <a class="btn" href="/set-node">Modify</a>}
						</div>
					</div>

					<label class="field">
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

					<label class="play-check">
						<input
							type="checkbox"
							checked={fill.value}
							onChange={(event) => fill.value = (event.target as HTMLInputElement).checked}
						/>
						Fill (crop) instead of letterbox
					</label>

					<label class="play-check">
						<input
							type="checkbox"
							checked={showStats.value}
							onChange={(event) => showStats.value = (event.target as HTMLInputElement).checked}
						/>
						Overlay WebRTC stats
					</label>

					<section class="play-help">
						<h3>Gamepad</h3>
						<dl>
							{KEYBOARD_HELP.map(([key, action]) => (
								<div>
									<dt>{key}</dt>
									<dd>{action}</dd>
								</div>
							))}
						</dl>
						<p>
							Home / PS / Guide is Home. Capture / Share is Capture. Xbox Guide opens Windows Game Bar:
							Settings &gt; Gaming &gt; Xbox Game Bar, turn off "Open Game Bar using this button on a
							controller". Until then, View+Menu is Home.
						</p>
					</section>
				</aside>
			)}

			<ul class="play-toasts" aria-live="polite">
				{toasts.value.map((item) => <li key={item.id}>{item.text}</li>)}
			</ul>
		</section>
	);
}
