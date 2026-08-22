export type WhepHandle = {
	pc: RTCPeerConnection;
	close: () => Promise<void>;
};

export type AudioWhepHandle = {
	setMuted: (muted: boolean) => void;
	setVolume: (volume: number) => void;
	resume: () => Promise<void>;
	close: () => Promise<void>;
};

const ice = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function tuneReceiver(receiver: RTCRtpReceiver): void {
	try {
		receiver.jitterBufferTarget = 16;
	} catch {
		// Chrome < 124
	}
	const legacy = receiver as RTCRtpReceiver & { playoutDelayHint?: number };
	if ("playoutDelayHint" in legacy) legacy.playoutDelayHint = 0.016;
}

function waitIceGathering(pc: RTCPeerConnection): Promise<void> {
	if (pc.iceGatheringState === "complete") return Promise.resolve();
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			pc.removeEventListener("icegatheringstatechange", onChange);
			resolve();
		};
		const onChange = () => {
			if (pc.iceGatheringState === "complete") done();
		};
		const timer = setTimeout(done, 2000);
		pc.addEventListener("icegatheringstatechange", onChange);
	});
}

async function postWhep(
	nodeUrl: string,
	route: string,
	pc: RTCPeerConnection,
): Promise<string | null> {
	const offer = await pc.createOffer();
	await pc.setLocalDescription(offer);
	await waitIceGathering(pc);

	const response = await fetch(`${nodeUrl}${route}`, {
		method: "POST",
		headers: { "content-type": "application/sdp" },
		body: pc.localDescription?.sdp ?? offer.sdp,
	});

	if (!response.ok) {
		pc.close();
		return null;
	}

	const answer = await response.text();
	const location = response.headers.get("location");
	await pc.setRemoteDescription({ type: "answer", sdp: answer });
	return location;
}

function closeWhep(pc: RTCPeerConnection, nodeUrl: string, location: string | null): () => Promise<void> {
	return async () => {
		pc.close();
		if (!location) return;
		const resource = new URL(location, `${nodeUrl}/`).href;
		await fetch(resource, { method: "DELETE" }).catch(() => {});
	};
}

export async function startWhep(
	nodeUrl: string,
	video: HTMLVideoElement,
	onIceFailed: () => void,
): Promise<WhepHandle> {
	const pc = new RTCPeerConnection(ice);
	pc.addTransceiver("video", { direction: "recvonly" });
	video.muted = true;

	pc.addEventListener("track", (event) => {
		if (event.track.kind !== "video") return;
		if (event.receiver) tuneReceiver(event.receiver);
		video.srcObject = new MediaStream([event.track]);
		void video.play().catch(() => {});
	});
	pc.addEventListener("connectionstatechange", () => {
		if (pc.connectionState === "failed") onIceFailed();
	});

	const location = await postWhep(nodeUrl, "/switch/whep", pc);
	if (!pc.remoteDescription) throw new Error("whep");

	const close = closeWhep(pc, nodeUrl, location);
	return {
		pc,
		close: async () => {
			video.srcObject = null;
			await close();
		},
	};
}

export async function startAudioWhep(nodeUrl: string): Promise<AudioWhepHandle | null> {
	const pc = new RTCPeerConnection(ice);
	let ctx: AudioContext | null = null;
	let gain: GainNode | null = null;
	let source: MediaStreamAudioSourceNode | null = null;
	let track: MediaStreamTrack | null = null;
	let muted = false;
	let volume = 1;

	function applyGain(): void {
		if (gain) gain.gain.value = muted ? 0 : volume;
	}

	function attach(): void {
		if (!ctx || !gain || !track) return;
		source?.disconnect();
		source = ctx.createMediaStreamSource(new MediaStream([track]));
		source.connect(gain);
		applyGain();
	}

	async function resume(): Promise<void> {
		if (!ctx) {
			ctx = new AudioContext({ latencyHint: "interactive" });
			gain = ctx.createGain();
			gain.connect(ctx.destination);
		}
		attach();
		if (ctx.state !== "running") await ctx.resume();
	}

	pc.addTransceiver("audio", { direction: "recvonly" });
	pc.addEventListener("track", (event) => {
		if (event.track.kind !== "audio") return;
		if (event.receiver) tuneReceiver(event.receiver);
		track = event.track;
		attach();
	});

	const location = await postWhep(nodeUrl, "/switch-audio/whep", pc);
	if (!pc.remoteDescription) return null;

	const close = closeWhep(pc, nodeUrl, location);
	return {
		setMuted: (next) => {
			muted = next;
			applyGain();
		},
		setVolume: (next) => {
			volume = next;
			applyGain();
		},
		resume,
		close: async () => {
			source?.disconnect();
			await ctx?.close().catch(() => {});
			await close();
		},
	};
}

export type StreamStats = {
	bitrateKbps: number;
	fps: number;
	packetsLost: number;
};

export async function readStreamStats(
	pc: RTCPeerConnection,
	prev: { bytes: number; at: number } | null,
): Promise<{ stats: StreamStats; prev: { bytes: number; at: number } }> {
	const report = await pc.getStats();
	let bytes = 0;
	let fps = 0;
	let packetsLost = 0;
	let at = performance.now();

	for (const item of report.values()) {
		if (item.type !== "inbound-rtp" || item.kind !== "video") continue;
		bytes = item.bytesReceived ?? 0;
		fps = item.framesPerSecond ?? 0;
		packetsLost = item.packetsLost ?? 0;
		at = item.timestamp ?? at;
	}

	const elapsed = prev ? Math.max(1, at - prev.at) : 1000;
	const delta = prev ? Math.max(0, bytes - prev.bytes) : 0;
	const bitrateKbps = Math.round((delta * 8) / elapsed);

	return { stats: { bitrateKbps, fps, packetsLost }, prev: { bytes, at } };
}
