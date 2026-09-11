interface DeviceOption {
	path: string;
	label: string;
}

interface DevicePickerProps {
	id: string;
	value: string;
	options: DeviceOption[];
	placeholder?: { value: string; label: string };
	detecting: boolean;
	onChange: (value: string) => void;
	onRefresh: () => void;
}

export function DevicePicker({
	id,
	value,
	options,
	placeholder,
	detecting,
	onChange,
	onRefresh,
}: DevicePickerProps) {
	return (
		<div className="select-with-button">
			<select
				id={id}
				value={value}
				onChange={(event) => onChange((event.currentTarget as HTMLSelectElement).value)}
			>
				{placeholder && <option value={placeholder.value}>{placeholder.label}</option>}
				{options.map((option) => (
					<option key={option.path} value={option.path}>
						{option.label}
					</option>
				))}
			</select>

			<button type="button" onClick={onRefresh} disabled={detecting}>
				{detecting ? "..." : "Refresh"}
			</button>
		</div>
	);
}
