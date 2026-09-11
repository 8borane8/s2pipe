import { useEffect, useState } from "preact/hooks";
import "./Toast.css";

type ToastType = "success" | "error";

export interface ToastOptions {
	description?: string;
}

export interface Toaster {
	id: number;
	type: ToastType;
	message: string;
	description?: string;
}

let toasters: Toaster[] = [];
let listeners: Array<(toasters: Toaster[]) => void> = [];
let nextId = 1;

function emit() {
	for (const listener of listeners) {
		listener(toasters);
	}
}

function addToaster(type: ToastType, message: string, options?: ToastOptions) {
	const id = nextId++;
	toasters = [...toasters, { id, type, message, description: options?.description }];
	emit();
	setTimeout(() => {
		toasters = toasters.filter((toaster) => toaster.id !== id);
		emit();
	}, type === "error" ? 6000 : 3500);
}

export function showSuccess(message: string, options?: ToastOptions) {
	addToaster("success", message, options);
}

export function showError(message: string, options?: ToastOptions) {
	addToaster("error", message, options);
}

export function useToasters(): Toaster[] {
	const [items, setItems] = useState<Toaster[]>(toasters);

	useEffect(() => {
		listeners.push(setItems);
		setItems(toasters);

		return () => {
			listeners = listeners.filter((listener) => listener !== setItems);
		};
	}, []);

	return items;
}

function Toasters({ toasters }: { toasters: Toaster[] }) {
	return (
		<div id="toasters">
			{toasters.map((toaster) => (
				<div key={toaster.id} className={toaster.type}>
					<p>{toaster.message}</p>
					{toaster.description && <small>{toaster.description}</small>}
				</div>
			))}
		</div>
	);
}

export { Toasters };
