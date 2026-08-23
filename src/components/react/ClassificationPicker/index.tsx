import { X } from 'lucide-react';
import * as React from 'react';
import {
	CLASSIFICATION_ORDER,
	CLASSIFICATIONS,
	MoveClassification,
} from 'src/lib/classification';

interface ClassificationPickerProps {
	classification: MoveClassification | null;
	onClassify: (classification: MoveClassification | null) => void;
	disabled: boolean;
}

export const ClassificationPicker = ({
	classification,
	onClassify,
	disabled,
}: ClassificationPickerProps) => {
	return (
		<div
			className="cs-classification-picker"
			role="group"
			aria-label="Move classification"
		>
			{CLASSIFICATION_ORDER.map((key) => {
				const { label, glyph, color, shortcut } = CLASSIFICATIONS[key];
				const isActive = classification === key;

				return (
					<button
						key={key}
						className={`cs-classification-button${
							isActive ? ' is-active' : ''
						}`}
						style={{ '--cs-classification': color } as React.CSSProperties}
						title={`${label} (${shortcut})`}
						aria-label={label}
						aria-pressed={isActive}
						disabled={disabled}
						// Clicking the active label removes it, so one button both sets
						// and unsets.
						onClick={() => onClassify(isActive ? null : key)}
					>
						{glyph}
					</button>
				);
			})}
			<button
				className="cs-classification-button cs-classification-button--clear"
				title="Clear classification (0)"
				aria-label="Clear classification"
				disabled={disabled || !classification}
				onClick={() => onClassify(null)}
			>
				<X size={13} />
			</button>
		</div>
	);
};
