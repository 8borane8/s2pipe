import { showError, showSuccess, Toasters, useToasters } from "./components/Toast.tsx";
import { DevicePicker } from "./components/DevicePicker.tsx";
import { useEffect, useState } from "preact/hooks";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

enum Status {
	OFFLINE = "offline",
	CONNECTING = "connecting",
	ONLINE = "online",
	STOPPING = "stopping",
	ERROR = "error",
}

interface Device {
	path: string;
	label: string;
}

interface WakeScanResult {
	switchBtMac: string;
	controllerBtMac: string;
	controllerBtPid: string;
}

interface AppConfig {
	nodePort: string;
	nodeBaseUrl: string;
	clientPort: string;
	exposure: string;

	mediaIceIp: string;
	mediaIcePort: string;

	captureSource: string;
	captureDevice: string;
	captureAudio: string;
	captureFormat: string;
	captureWidth: number;
	captureHeight: number;
	captureFps: number;

	videoEncoder: string;
	videoCodec: string;
	videoBitrate: string;

	picoSerial: string;

	switchBtMac: string;
	controllerBtMac: string;
	controllerBtPid: string;

	launchAtStartup: boolean;
}

/* -------------------------------------------------------------------------- */
/* Defaults                                                                   */
/* -------------------------------------------------------------------------- */

const DEFAULT_CONFIG: AppConfig = {
	nodePort: "5050",
	nodeBaseUrl: "http://localhost:5050",
	clientPort: "5000",
	exposure: "local",

	mediaIceIp: "127.0.0.1",
	mediaIcePort: "8189",

	captureSource: "test",
	captureDevice: "",
	captureAudio: "",
	captureFormat: "yuyv422",
	captureWidth: 1920,
	captureHeight: 1080,
	captureFps: 60,

	videoEncoder: "auto",
	videoCodec: "h264",
	videoBitrate: "6M",

	picoSerial: "",

	switchBtMac: "",
	controllerBtMac: "",
	controllerBtPid: "",

	launchAtStartup: false,
};

const RESOLUTION_PRESETS = [
	{ key: "4k", label: "4K", width: 3840, height: 2160 },
	{ key: "1080p", label: "1080p", width: 1920, height: 1080 },
	{ key: "720p", label: "720p", width: 1280, height: 720 },
	{ key: "480p", label: "480p", width: 854, height: 480 },
];

const FPS_PRESETS = [120, 60, 30];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function nodeAddress(ip: string, port: string): string {
	const host = ip === "127.0.0.1" ? "localhost" : ip;
	const trimmed = port.trim();
	return trimmed ? `http://${host}:${trimmed}` : `http://${host}`;
}

function isGeneratedNodeAddress(url: string, ip: string, port: string): boolean {
	const normalized = url.trim().replace(/\/+$/, "");
	if (normalized === nodeAddress(ip, port)) {
		return true;
	}

	if (ip !== "127.0.0.1") {
		return false;
	}

	const trimmed = port.trim();
	return normalized === (trimmed ? `http://127.0.0.1:${trimmed}` : "http://127.0.0.1");
}

function mergeConfig(config: Partial<AppConfig> | null | undefined): AppConfig {
	return {
		...DEFAULT_CONFIG,
		...(config ?? {}),
	};
}

function isValidPort(value: string): boolean {
	const port = Number(value.trim());
	return Number.isInteger(port) && port > 0 && port <= 65535;
}

function maskMac(mac: string): string {
	const parts = mac.trim().split(":");

	if (parts.length !== 6) {
		return mac;
	}

	return `--:--:${parts[4]}:${parts[5]}`;
}

/* -------------------------------------------------------------------------- */
/* App                                                                        */
/* -------------------------------------------------------------------------- */

function App() {
	const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);

	const [status, setStatus] = useState<Status>(Status.OFFLINE);
	const [advancedMode, setAdvancedMode] = useState(false);
	const [loading, setLoading] = useState(true);

	const [captureDevices, setCaptureDevices] = useState<Device[]>([]);
	const [audioDevices, setAudioDevices] = useState<Device[]>([]);
	const [serialPorts, setSerialPorts] = useState<Device[]>([]);

	const [detectingCapture, setDetectingCapture] = useState(false);
	const [detectingAudio, setDetectingAudio] = useState(false);
	const [detectingSerial, setDetectingSerial] = useState(false);

	const [scanning, setScanning] = useState(false);
	const [bluetoothError, setBluetoothError] = useState(false);

	const toasters = useToasters();

	/* ---------------------------------------------------------------------- */
	/* Derived values                                                         */
	/* ---------------------------------------------------------------------- */

	const bluetoothConfigured = config.switchBtMac.trim() !== "" &&
		config.controllerBtMac.trim() !== "" &&
		config.controllerBtPid.trim() !== "";

	const isResolutionActive = (width: number, height: number) =>
		config.captureWidth === width &&
		config.captureHeight === height;

	const isFpsActive = (fps: number) => config.captureFps === fps;

	const captureSelectValue = config.captureSource === "test" ? "test" : config.captureDevice;

	/* ---------------------------------------------------------------------- */
	/* Config                                                                  */
	/* ---------------------------------------------------------------------- */

	function updateConfig<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
		setConfig((current) => ({
			...current,
			[key]: value,
		}));
	}

	function applyHost(exposure: string, ip: string) {
		setConfig((current) => ({
			...current,
			exposure,
			nodeBaseUrl: nodeAddress(ip, current.nodePort),
			mediaIceIp: ip,
		}));
	}

	function updateNodePort(port: string) {
		setConfig((current) => {
			const generated = isGeneratedNodeAddress(
				current.nodeBaseUrl,
				current.mediaIceIp,
				current.nodePort,
			);

			return {
				...current,
				nodePort: port,
				nodeBaseUrl: generated ? nodeAddress(current.mediaIceIp, port) : current.nodeBaseUrl,
			};
		});
	}

	async function applyExposure(value: string) {
		if (value === "local") {
			applyHost("local", "127.0.0.1");
			return;
		}

		try {
			const ip = await invoke<string>(value === "lan" ? "local_ip" : "public_ip");
			applyHost(value, ip);
		} catch (error) {
			setConfig((current) => ({ ...current, exposure: value }));
			showError(
				value === "lan" ? "Could not detect the LAN IP." : "Could not detect the public IP.",
				{ description: getErrorMessage(error) },
			);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Initial load                                                            */
	/* ---------------------------------------------------------------------- */

	useEffect(() => {
		let unlisten: (() => void) | undefined;
		let cancelled = false;

		void (async () => {
			unlisten = await listen<string>("stack-status", (event) => {
				if (cancelled) return;
				if (event.payload.startsWith("error:")) {
					setStatus(Status.ERROR);
					showError("Could not start s2pipe.", {
						description: event.payload.slice("error:".length),
					});
				}
			});

			await loadInitialState();
		})();

		return () => {
			cancelled = true;
			unlisten?.();
		};
	}, []);

	async function loadInitialState() {
		setLoading(true);

		try {
			const lastConfig = await invoke<Partial<AppConfig> | null>("load_last_config");
			const merged = mergeConfig(lastConfig);
			setConfig(merged);

			const running = await invoke<boolean>("is_stack_running");
			if (running) {
				setStatus(Status.ONLINE);
			}
		} catch (error) {
			console.error("load_last_config failed:", error);
		} finally {
			setLoading(false);
			void refreshCaptureDevices(true);
			void refreshAudioDevices(true);
			void refreshSerialPorts();
		}
	}

	async function persistConfig(next: AppConfig) {
		try {
			await invoke("save_app_config", { config: next });
		} catch (error) {
			console.error("save_app_config failed:", error);
			showError("Could not save launcher settings.", {
				description: getErrorMessage(error),
			});
		}
	}

	function setLaunchAtStartup(enabled: boolean) {
		setConfig((current) => {
			const next = { ...current, launchAtStartup: enabled };
			void persistConfig(next);
			return next;
		});
	}

	/* ---------------------------------------------------------------------- */
	/* Capture devices                                                        */
	/* ---------------------------------------------------------------------- */

	async function refreshCaptureDevices(silent = false) {
		setDetectingCapture(true);

		try {
			const devices = await invoke<Device[]>("list_capture_devices");
			setCaptureDevices(devices);

			if (
				config.captureSource !== "test" &&
				devices.length > 0 &&
				!devices.some(
					(device) => device.path === config.captureDevice,
				)
			) {
				updateConfig("captureDevice", devices[0].path);
			}

			if (!silent && devices.length === 0 && config.captureSource !== "test") {
				showError("No capture card detected.");
			}
		} catch (error) {
			console.error("list_capture_devices failed:", error);
			if (!silent) {
				showError("Capture device detection is unavailable.");
			}
		} finally {
			setDetectingCapture(false);
		}
	}

	async function refreshAudioDevices(silent = false) {
		setDetectingAudio(true);

		try {
			const devices = await invoke<Device[]>("list_audio_devices");
			setAudioDevices(devices);

			if (
				config.captureAudio &&
				devices.length > 0 &&
				!devices.some(
					(device) => device.path === config.captureAudio,
				)
			) {
				updateConfig("captureAudio", devices[0].path);
			}
		} catch (error) {
			console.error("list_audio_devices failed:", error);
			if (!silent) {
				showError("Audio device detection is unavailable.");
			}
		} finally {
			setDetectingAudio(false);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Serial ports                                                            */
	/* ---------------------------------------------------------------------- */

	async function refreshSerialPorts() {
		setDetectingSerial(true);

		try {
			const ports = await invoke<Device[]>("list_serial_ports");
			setSerialPorts(ports);
		} catch (error) {
			console.error("list_serial_ports failed:", error);
			showError("Serial port detection is unavailable.");
		} finally {
			setDetectingSerial(false);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Capture source                                                          */
	/* ---------------------------------------------------------------------- */

	function handleCaptureSourceChange(value: string) {
		if (value === "test") {
			updateConfig("captureSource", "test");
			return;
		}

		updateConfig("captureSource", "v4l2");
		updateConfig("captureDevice", value);
	}

	/* ---------------------------------------------------------------------- */
	/* Bluetooth                                                               */
	/* ---------------------------------------------------------------------- */

	async function handleScanPad() {
		if (scanning) {
			return;
		}

		setScanning(true);
		setBluetoothError(false);

		try {
			const result = await invoke<WakeScanResult | null>("scan_bluetooth_pad", { timeoutMs: 20000 });
			if (!result) {
				setBluetoothError(true);
				showError("No controller found.", {
					description: "Put the Switch 2 to sleep and press a button on the paired controller.",
				});
				return;
			}

			updateConfig("switchBtMac", result.switchBtMac);
			updateConfig("controllerBtMac", result.controllerBtMac);
			updateConfig("controllerBtPid", result.controllerBtPid);
			setBluetoothError(false);

			showSuccess("Bluetooth controller detected.");
		} catch (error) {
			console.error("scan_bluetooth_pad failed:", error);
			setBluetoothError(true);

			showError("Bluetooth scan failed.", { description: getErrorMessage(error) });
		} finally {
			setScanning(false);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Validation                                                              */
	/* ---------------------------------------------------------------------- */

	function validateConfig(): boolean {
		if (!isValidPort(config.nodePort)) {
			showError("Node port is invalid.");
			return false;
		}

		if (!isValidPort(config.clientPort)) {
			showError("Client port is invalid.");
			return false;
		}

		if (!isValidPort(config.mediaIcePort)) {
			showError("ICE port is invalid.");
			return false;
		}

		if (config.captureWidth <= 0 || config.captureHeight <= 0) {
			showError("Capture resolution is invalid.");
			return false;
		}

		if (config.captureFps <= 0 || config.captureFps > 120) {
			showError("FPS must be between 1 and 120.");
			return false;
		}

		if (config.captureSource !== "test" && !config.captureDevice.trim()) {
			showError("Select a capture device, or use the test source.");
			return false;
		}

		const bluetoothPartiallyConfigured = config.switchBtMac.trim() !== "" ||
			config.controllerBtMac.trim() !== "" ||
			config.controllerBtPid.trim() !== "";

		if (bluetoothPartiallyConfigured && !bluetoothConfigured) {
			showError("Bluetooth configuration is incomplete.");
			return false;
		}

		return true;
	}

	/* ---------------------------------------------------------------------- */
	/* Start                                                                   */
	/* ---------------------------------------------------------------------- */

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();

		if (status === Status.ONLINE || status === Status.CONNECTING || status === Status.STOPPING) {
			return;
		}

		if (!validateConfig()) {
			return;
		}

		setStatus(Status.CONNECTING);

		try {
			await invoke("start_s2pipe", { config });
			setStatus(Status.ONLINE);

			showSuccess("s2pipe started.");
		} catch (error) {
			console.error("start_s2pipe failed:", error);
			setStatus(Status.ERROR);

			showError("Could not start s2pipe.", { description: getErrorMessage(error) });
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Stop                                                                    */
	/* ---------------------------------------------------------------------- */

	async function stopS2Pipe() {
		if (status !== Status.ONLINE) {
			return;
		}

		setStatus(Status.STOPPING);

		try {
			await invoke("stop_s2pipe");
			setStatus(Status.OFFLINE);

			showSuccess("s2pipe stopped.");
		} catch (error) {
			console.error("stop_s2pipe failed:", error);
			setStatus(Status.ERROR);

			showError(
				"Could not stop s2pipe.",
				{
					description: getErrorMessage(error),
				},
			);
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Status                                                                  */
	/* ---------------------------------------------------------------------- */

	function renderStatus() {
		switch (status) {
			case Status.CONNECTING:
				return "Connecting...";

			case Status.ONLINE:
				return "Online";

			case Status.STOPPING:
				return "Stopping...";

			case Status.ERROR:
				return "Error";

			case Status.OFFLINE:
			default:
				return "Offline";
		}
	}

	/* ---------------------------------------------------------------------- */
	/* Loading                                                                 */
	/* ---------------------------------------------------------------------- */

	if (loading) {
		return (
			<main>
				<header>
					<h1 className="brand">
						<span>s2</span>pipe
					</h1>

					<p className="pill">
						Loading...
					</p>
				</header>

				<div>
					Loading configuration...
				</div>

				<Toasters toasters={toasters} />
			</main>
		);
	}

	/* ---------------------------------------------------------------------- */
	/* Render                                                                  */
	/* ---------------------------------------------------------------------- */

	return (
		<main>
			<header>
				<h1 className="brand">
					<span>s2</span>pipe
				</h1>

				<p
					className="pill"
					data-ok={status === Status.ONLINE ? "true" : status === Status.ERROR ? "false" : undefined}
					data-busy={status === Status.CONNECTING || status === Status.STOPPING ? "true" : undefined}
				>
					{renderStatus()}
				</p>
			</header>

			<form onSubmit={handleSubmit}>
				<div className="form-body">
					{/* ---------------------------------------------------------------- */}
					{/* Node & Client                                                     */}
					{/* ---------------------------------------------------------------- */}

					<fieldset>
						<section>
							<h2>Node & Client</h2>
							<p>
								HTTP/WebSocket node and browser client ports.
							</p>
						</section>

						<label>
							<span>
								Where do you want to be able to access it
							</span>

							<select
								id="exposure"
								value={config.exposure}
								onChange={(event) =>
									void applyExposure(
										(event.currentTarget as HTMLSelectElement).value,
									)}
							>
								<option value="local">
									This PC only
								</option>

								<option value="lan">
									LAN (my local network)
								</option>

								<option value="wan">
									Accessible from the internet
								</option>
							</select>

							<small>
								{config.exposure === "local" &&
									"Everything runs on this machine. Keep the default values."}

								{config.exposure === "lan" &&
									"Filled with this PC's LAN address so other devices on the network can reach it."}

								{config.exposure === "wan" &&
									"Filled with this PC's public IP. There is no authentication: put your own security in front of it."}
							</small>
						</label>

						{config.exposure !== "local" && (
							<label>
								<span>Node address</span>

								<input
									id="nodeBaseUrl"
									type="url"
									value={config.nodeBaseUrl}
									onInput={(event) =>
										updateConfig(
											"nodeBaseUrl",
											(
												event.currentTarget as HTMLInputElement
											).value,
										)}
									placeholder="http://192.168.1.20:5050"
								/>

								<small>
									This is the address browsers will use to connect.
								</small>
							</label>
						)}

						{advancedMode && (
							<div className="fields-grid advanced">
								<div className="field">
									<label>
										<span>Node port</span>

										<input
											id="nodePort"
											type="text"
											value={config.nodePort}
											onInput={(event) =>
												updateNodePort(
													(
														event.currentTarget as HTMLInputElement
													).value,
												)}
											placeholder="5050"
										/>
									</label>
								</div>

								<div className="field">
									<label>
										<span>Client port</span>

										<input
											id="clientPort"
											type="text"
											value={config.clientPort}
											onInput={(event) =>
												updateConfig(
													"clientPort",
													(
														event.currentTarget as HTMLInputElement
													).value,
												)}
											placeholder="5000"
										/>
									</label>
								</div>
							</div>
						)}
					</fieldset>

					{/* ---------------------------------------------------------------- */}
					{/* Media / ICE                                                       */}
					{/* ---------------------------------------------------------------- */}

					{advancedMode && (
						<fieldset className="advanced">
							<section>
								<h2>Media / ICE</h2>

								<p>
									WebRTC ICE endpoint used for the video/audio stream.
								</p>
							</section>

							<div className="fields-grid advanced">
								<div className="field">
									<label>
										<span>ICE IP</span>

										<input
											id="mediaIceIp"
											type="text"
											value={config.mediaIceIp}
											onInput={(event) =>
												updateConfig(
													"mediaIceIp",
													(
														event.currentTarget as HTMLInputElement
													).value,
												)}
											placeholder="127.0.0.1"
										/>
									</label>
								</div>

								<div className="field">
									<label>
										<span>ICE port (UDP)</span>

										<input
											id="mediaIcePort"
											type="text"
											value={config.mediaIcePort}
											onInput={(event) =>
												updateConfig(
													"mediaIcePort",
													(
														event.currentTarget as HTMLInputElement
													).value,
												)}
											placeholder="8189"
										/>
									</label>
								</div>
							</div>
						</fieldset>
					)}

					{/* ---------------------------------------------------------------- */}
					{/* Capture                                                            */}
					{/* ---------------------------------------------------------------- */}

					<fieldset>
						<section>
							<h2>Capture</h2>

							<p>
								HDMI capture source and encode settings.
							</p>
						</section>

						<label>
							<span>Video source</span>

							<DevicePicker
								id="captureSource"
								value={captureSelectValue}
								placeholder={{
									value: "test",
									label: "Test (color bars, no hardware needed)",
								}}
								options={captureDevices}
								detecting={detectingCapture}
								onChange={handleCaptureSourceChange}
								onRefresh={() => void refreshCaptureDevices()}
							/>

							<small>
								Choose your HDMI capture card or use Test without hardware.
							</small>
						</label>

						<div className="field">
							<label>
								<span>
									Audio source
								</span>

								<DevicePicker
									id="captureAudio"
									value={config.captureAudio}
									placeholder={{ value: "", label: "None" }}
									options={audioDevices}
									detecting={detectingAudio}
									onChange={(value) => updateConfig("captureAudio", value)}
									onRefresh={() => void refreshAudioDevices()}
								/>

								<small>
									Choose the audio input from your HDMI capture device.
								</small>
							</label>
						</div>

						<div className="presets-block">
							<span>Resolution</span>

							<div className="presets">
								{RESOLUTION_PRESETS.map((preset) => (
									<button
										type="button"
										key={preset.key}
										className={`preset-btn${
											isResolutionActive(
													preset.width,
													preset.height,
												)
												? " active"
												: ""
										}`}
										onClick={() => {
											updateConfig(
												"captureWidth",
												preset.width,
											);

											updateConfig(
												"captureHeight",
												preset.height,
											);
										}}
									>
										{preset.label}
									</button>
								))}
							</div>
						</div>

						<div className="presets-block">
							<span>FPS</span>

							<div className="presets">
								{FPS_PRESETS.map((fps) => (
									<button
										type="button"
										key={fps}
										className={`preset-btn${isFpsActive(fps) ? " active" : ""}`}
										onClick={() =>
											updateConfig(
												"captureFps",
												fps,
											)}
									>
										{fps}
									</button>
								))}
							</div>
						</div>

						{advancedMode && (
							<>
								<div className="fields-grid advanced">
									<div className="field">
										<label>
											<span>Encoder</span>

											<select
												id="videoEncoder"
												value={config.videoEncoder}
												onChange={(event) =>
													updateConfig(
														"videoEncoder",
														(
															event.currentTarget as HTMLSelectElement
														).value,
													)}
											>
												<option value="auto">
													Auto (use the GPU if there is one)
												</option>

												<option value="cpu">
													CPU (x264/x265)
												</option>

												<option value="nvenc">
													NVIDIA (NVENC)
												</option>

												<option value="amf">
													AMD (AMF)
												</option>
											</select>
										</label>
									</div>

									<div className="field">
										<label>
											<span>Codec</span>

											<select
												id="videoCodec"
												value={config.videoCodec}
												onChange={(event) =>
													updateConfig(
														"videoCodec",
														(
															event.currentTarget as HTMLSelectElement
														).value,
													)}
											>
												<option value="h264">
													H.264
												</option>

												<option value="h265">
													H.265 (HEVC)
												</option>
											</select>
										</label>
									</div>
								</div>

								<small>
									{config.videoCodec === "h265"
										? "H.265 halves the bitrate but many browsers cannot play it over WebRTC. Use H.264 if the picture stays black."
										: "H.264 plays everywhere. Auto falls back to the CPU when no GPU encoder answers."}
								</small>

								<div className="fields-grid advanced">
									<div className="field">
										<label>
											<span>Width</span>

											<input
												id="captureWidth"
												type="number"
												min="1"
												value={config.captureWidth}
												onInput={(event) =>
													updateConfig(
														"captureWidth",
														Number(
															(
																event.currentTarget as HTMLInputElement
															).value,
														),
													)}
											/>
										</label>
									</div>

									<div className="field">
										<label>
											<span>Height</span>

											<input
												id="captureHeight"
												type="number"
												min="1"
												value={config.captureHeight}
												onInput={(event) =>
													updateConfig(
														"captureHeight",
														Number(
															(
																event.currentTarget as HTMLInputElement
															).value,
														),
													)}
											/>
										</label>
									</div>
								</div>

								<div className="fields-grid advanced">
									<div className="field">
										<label>
											<span>FPS</span>

											<input
												id="captureFps"
												type="number"
												min="1"
												max="120"
												value={config.captureFps}
												onInput={(event) =>
													updateConfig(
														"captureFps",
														Number(
															(
																event.currentTarget as HTMLInputElement
															).value,
														),
													)}
											/>
										</label>
									</div>

									<div className="field">
										<label>
											<span>
												Capture format
											</span>

											<select
												id="captureFormat"
												value={config.captureFormat}
												onChange={(event) =>
													updateConfig(
														"captureFormat",
														(
															event.currentTarget as HTMLSelectElement
														).value,
													)}
											>
												<option value="yuyv422">
													yuyv422
												</option>

												<option value="mjpeg">
													mjpeg
												</option>
											</select>
										</label>
									</div>
								</div>

								<div className="fields-grid advanced">
									<div className="field">
										<label>
											<span>
												Video bitrate
											</span>

											<input
												id="videoBitrate"
												type="text"
												value={config.videoBitrate}
												onInput={(event) =>
													updateConfig(
														"videoBitrate",
														(
															event.currentTarget as HTMLInputElement
														).value,
													)}
												placeholder="6M"
											/>
										</label>
									</div>
								</div>

								<div className="fields-grid advanced">
									<div className="field">
										<label>
											<span>
												Capture device
											</span>

											<input
												id="captureDevice"
												type="text"
												value={config.captureDevice}
												onInput={(event) =>
													updateConfig(
														"captureDevice",
														(
															event.currentTarget as HTMLInputElement
														).value,
													)}
												placeholder="/dev/video0"
											/>
										</label>
									</div>

									<div className="field">
										<label>
											<span>
												HDMI audio (ALSA)
											</span>

											<input
												id="captureAudioManual"
												type="text"
												value={config.captureAudio}
												onInput={(event) =>
													updateConfig(
														"captureAudio",
														(
															event.currentTarget as HTMLInputElement
														).value,
													)}
												placeholder="hw:0,0"
											/>
										</label>
									</div>
								</div>
							</>
						)}
					</fieldset>

					{/* ---------------------------------------------------------------- */}
					{/* Pico                                                               */}
					{/* ---------------------------------------------------------------- */}

					<fieldset>
						<section>
							<h2>Pico</h2>

							<p>
								Serial link to the Pico that drives the USB pads.
							</p>
						</section>

						<label>
							<span>Pico port</span>

							<DevicePicker
								id="picoSerial"
								value={config.picoSerial}
								placeholder={{ value: "", label: "None (video only)" }}
								options={serialPorts}
								detecting={detectingSerial}
								onChange={(value) => updateConfig("picoSerial", value)}
								onRefresh={() => void refreshSerialPorts()}
							/>

							<small>
								Choose None if you only need video.
							</small>
						</label>

						{advancedMode && (
							<div className="fields-grid advanced">
								<div className="field">
									<label>
										<span>Manual port</span>

										<input
											id="picoSerialManual"
											type="text"
											value={config.picoSerial}
											onInput={(event) =>
												updateConfig(
													"picoSerial",
													(
														event.currentTarget as HTMLInputElement
													).value,
												)}
											placeholder="/dev/ttyUSB0 or COM3"
										/>
									</label>
								</div>
							</div>
						)}
					</fieldset>

					{/* ---------------------------------------------------------------- */}
					{/* Bluetooth                                                          */}
					{/* ---------------------------------------------------------------- */}

					<fieldset>
						<section>
							<h2>Sleep wake (Bluetooth)</h2>

							<p>
								Optional: wake the Switch 2 from sleep using a paired controller.
							</p>
						</section>

						<div className="select-with-button">
							<button
								type="button"
								onClick={() => void handleScanPad()}
								disabled={scanning}
								id="scan-pad-button"
								className={bluetoothError ? "button-error" : ""}
							>
								{scanning
									? "Listening..."
									: bluetoothConfigured
									? "Bluetooth configured"
									: "Listen for controller"}
							</button>
						</div>

						<small>
							{bluetoothConfigured
								? `Controller ${maskMac(config.controllerBtMac)} configured.`
								: "Pair the controller with the Switch normally first, put the console to sleep, then press a button."}
						</small>

						{advancedMode && (
							<>
								<div className="fields-grid advanced">
									<div className="field">
										<label>
											<span>
												Switch Bluetooth MAC
											</span>

											<input
												id="switchBtMac"
												type="text"
												value={config.switchBtMac}
												onInput={(event) =>
													updateConfig(
														"switchBtMac",
														(
															event.currentTarget as HTMLInputElement
														).value,
													)}
												placeholder="AA:BB:CC:DD:EE:FF"
											/>
										</label>
									</div>

									<div className="field">
										<label>
											<span>
												Controller Bluetooth MAC
											</span>

											<input
												id="controllerBtMac"
												type="text"
												value={config.controllerBtMac}
												onInput={(event) =>
													updateConfig(
														"controllerBtMac",
														(
															event.currentTarget as HTMLInputElement
														).value,
													)}
												placeholder="AA:BB:CC:DD:EE:FF"
											/>
										</label>
									</div>
								</div>

								<div className="fields-grid advanced">
									<div className="field">
										<label>
											<span>
												Controller Bluetooth PID
											</span>

											<input
												id="controllerBtPid"
												type="text"
												value={config.controllerBtPid}
												onInput={(event) =>
													updateConfig(
														"controllerBtPid",
														(
															event.currentTarget as HTMLInputElement
														).value,
													)}
												placeholder="0x2069"
											/>
										</label>
									</div>
								</div>
							</>
						)}
					</fieldset>

					{/* ---------------------------------------------------------------- */}
					{/* Launcher                                                           */}
					{/* ---------------------------------------------------------------- */}

					<fieldset>
						<section>
							<h2>Launcher</h2>

							<p>
								Behavior of this launcher app, separate from s2pipe itself.
							</p>
						</section>

						<div className="toggles">
							<label className="toggle">
								<input
									type="checkbox"
									checked={config.launchAtStartup}
									onChange={(event) =>
										setLaunchAtStartup(
											(
												event.currentTarget as HTMLInputElement
											).checked,
										)}
								/>

								<span className="toggle-ui" />

								<div>
									<strong>
										Launch at startup
									</strong>

									<small>
										On login, start s2pipe in the background and close the launcher.
									</small>
								</div>
							</label>
						</div>
					</fieldset>
				</div>

				{/* ---------------------------------------------------------------- */}
				{/* Bottom controls                                                    */}
				{/* ---------------------------------------------------------------- */}

				<div className="mode-row">
					<label className="switch">
						<input
							type="checkbox"
							checked={advancedMode}
							onChange={(event) =>
								setAdvancedMode(
									(
										event.currentTarget as HTMLInputElement
									).checked,
								)}
						/>

						<span className="switch-ui" />

						<span className="switch-label">
							Advanced settings
						</span>
					</label>

					<div className="actions">
						<button
							type="button"
							className="stop"
							disabled={status !== Status.ONLINE}
							onClick={() => void stopS2Pipe()}
						>
							Stop
						</button>

						<button
							type="submit"
							className={status === Status.CONNECTING ? "start starting" : "start"}
							disabled={status === Status.ONLINE || status === Status.STOPPING}
							aria-busy={status === Status.CONNECTING ? "true" : undefined}
						>
							{status === Status.CONNECTING ? "Starting..." : "Start s2pipe"}
						</button>
					</div>
				</div>
			</form>

			<Toasters toasters={toasters} />
		</main>
	);
}

export default App;
