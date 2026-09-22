import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Camera, House, Minus, Plus } from "lucide-preact";
import type { ComponentChildren } from "preact";

import { PAD_CENTER, type PadState } from "@s2pipe/shared/types/pad";

import {
	type Bindings,
	describeInput,
	describeStickDir,
	PAD_BUTTON_BITS,
	PAD_BUTTON_LABELS,
	type PadButtonName,
	type StickBinding,
	type StickDir,
	type StickId,
	type StickListen,
} from "../utils/virtual/mod.ts";

type Props = {
	bindings: Bindings;
	live: PadState;
	listening: PadButtonName | StickListen | null;
	onButton: (name: PadButtonName) => void;
	onStickDir: (id: StickId, dir: StickDir) => void;
	onStickMode: (id: StickId, mode: "mouse" | "none") => void;
};

const DIR_ICON = {
	up: ArrowUp,
	down: ArrowDown,
	left: ArrowLeft,
	right: ArrowRight,
	Up: ArrowUp,
	Down: ArrowDown,
	Left: ArrowLeft,
	Right: ArrowRight,
	Minus: Minus,
	Plus: Plus,
	Home: House,
	Capture: Camera,
} as const;

function PadCell({
	label,
	bind,
	shape,
	active,
	pressed,
	ariaLabel,
	onClick,
}: {
	label: ComponentChildren;
	bind: string;
	shape?: "trigger" | "bumper" | "pip" | "face" | "dpad" | "nub" | "dir";
	active?: boolean;
	pressed?: boolean;
	ariaLabel?: string;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			className="pad-cell"
			data-shape={shape}
			data-active={active ? "true" : undefined}
			aria-label={ariaLabel}
			aria-pressed={pressed}
			title={bind}
			onClick={onClick}
		>
			<span>{label}</span>
			<span>{bind}</span>
		</button>
	);
}

function Face({
	name,
	shape,
	bindings,
	live,
	listening,
	onButton,
}: {
	name: PadButtonName;
	shape?: "trigger" | "bumper" | "pip" | "face" | "dpad";
	bindings: Bindings;
	live: PadState;
	listening: PadButtonName | StickListen | null;
	onButton: (name: PadButtonName) => void;
}) {
	const down = (live.buttons & PAD_BUTTON_BITS[name]) !== 0;
	const Icon = name in DIR_ICON ? DIR_ICON[name as keyof typeof DIR_ICON] : null;
	return (
		<PadCell
			label={Icon ? <Icon size={16} aria-hidden="true" /> : name}
			bind={describeInput(bindings.buttons[name])}
			shape={shape}
			active={down}
			pressed={listening === name}
			onClick={() => onButton(name)}
			ariaLabel={PAD_BUTTON_LABELS[name]}
		/>
	);
}

function dirPushed(binding: StickBinding, dir: StickDir, x: number, y: number): boolean {
	if (binding.kind === "none") return false;
	if (dir === "left") return x < PAD_CENTER - 10;
	if (dir === "right") return x > PAD_CENTER + 10;
	if (dir === "up") return y < PAD_CENTER - 10;
	return y > PAD_CENTER + 10;
}

function Stick({
	id,
	bindings,
	live,
	listening,
	onButton,
	onStickDir,
	onStickMode,
}: {
	id: StickId;
	bindings: Bindings;
	live: PadState;
	listening: PadButtonName | StickListen | null;
	onButton: (name: PadButtonName) => void;
	onStickDir: (id: StickId, dir: StickDir) => void;
	onStickMode: (id: StickId, mode: "mouse" | "none") => void;
}) {
	const click = id === "left" ? "LStick" : "RStick";
	const binding = bindings.sticks[id];
	const x = id === "left" ? live.lx : live.rx;
	const y = id === "left" ? live.ly : live.ry;
	const clickDown = (live.buttons & PAD_BUTTON_BITS[click]) !== 0;
	const dirCell = (dir: StickDir) => {
		const Icon = DIR_ICON[dir];
		return (
			<PadCell
				label={<Icon size={14} aria-hidden="true" />}
				bind={describeStickDir(binding, dir)}
				shape="dir"
				active={dirPushed(binding, dir, x, y)}
				pressed={typeof listening === "object" && listening !== null && listening.id === id &&
					listening.dir === dir}
				ariaLabel={`${id === "left" ? "Left" : "Right"} stick ${dir}`}
				onClick={() => onStickDir(id, dir)}
			/>
		);
	};
	return (
		<div className="stick">
			<div>
				{dirCell("up")}
				{dirCell("left")}
				<PadCell
					label={click === "LStick" ? "L3" : "R3"}
					bind={describeInput(bindings.buttons[click])}
					shape="nub"
					active={clickDown}
					pressed={listening === click}
					ariaLabel={PAD_BUTTON_LABELS[click]}
					onClick={() => onButton(click)}
				/>
				{dirCell("right")}
				{dirCell("down")}
			</div>
			<div>
				<button
					type="button"
					className="btn"
					aria-pressed={binding.kind === "mouse"}
					onClick={() => onStickMode(id, "mouse")}
				>
					Mouse
				</button>
				<button
					type="button"
					className="btn"
					aria-pressed={binding.kind === "none"}
					onClick={() => onStickMode(id, "none")}
				>
					Off
				</button>
			</div>
		</div>
	);
}

export default function ControllerPad(props: Props) {
	const { bindings, live, listening, onButton, onStickDir, onStickMode } = props;
	return (
		<div id="pad">
			<div>
				<Face
					name="ZL"
					shape="trigger"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
				<Face
					name="ZR"
					shape="trigger"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
			</div>
			<div>
				<Face
					name="L"
					shape="bumper"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
				<Face
					name="Minus"
					shape="pip"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
				<Face
					name="Capture"
					shape="pip"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
				<Face
					name="Home"
					shape="pip"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
				<Face
					name="Plus"
					shape="pip"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
				<Face
					name="R"
					shape="bumper"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
				/>
			</div>
			<div>
				<Stick
					id="left"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
					onStickDir={onStickDir}
					onStickMode={onStickMode}
				/>
				<div className="pad-cluster">
					<Face
						name="Up"
						shape="dpad"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
					<Face
						name="Left"
						shape="dpad"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
					<Face
						name="Right"
						shape="dpad"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
					<Face
						name="Down"
						shape="dpad"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
				</div>
				<div className="pad-cluster">
					<Face
						name="X"
						shape="face"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
					<Face
						name="Y"
						shape="face"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
					<Face
						name="A"
						shape="face"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
					<Face
						name="B"
						shape="face"
						bindings={bindings}
						live={live}
						listening={listening}
						onButton={onButton}
					/>
				</div>
				<Stick
					id="right"
					bindings={bindings}
					live={live}
					listening={listening}
					onButton={onButton}
					onStickDir={onStickDir}
					onStickMode={onStickMode}
				/>
			</div>
		</div>
	);
}
