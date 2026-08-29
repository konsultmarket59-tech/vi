import { useEffect, useRef, useState } from "react";

interface Props {
  title: string;
  label?: string;
  initialValue?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Replaces window.prompt(), which does not exist in an Electron renderer — calling
 * it throws and silently kills the handler it was called from.
 */
export default function Prompt({
  title,
  label,
  initialValue = "",
  confirmLabel = "ОК",
  onSubmit,
  onCancel,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="modal-title">{title}</h3>
        {label && <label className="field-label">{label}</label>}
        <input
          ref={input}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
            if (e.key === "Escape") onCancel();
          }}
        />
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            Отмена
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!value.trim()}
            onClick={() => onSubmit(value.trim())}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
