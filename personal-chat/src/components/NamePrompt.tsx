import { useEffect, useRef, useState } from "react";

/**
 * Small "type a name" dialog.
 *
 * Electron's renderer has no window.prompt() — calling it throws "prompt() is not
 * supported" and the surrounding handler simply stops, so buttons like «Переименовать»
 * did nothing at all. This replaces it with a real element.
 */
export interface NamePromptRequest {
  title: string;
  initial?: string;
  confirmLabel?: string;
  onSubmit: (value: string) => void;
}

export default function NamePrompt({
  request,
  onClose,
}: {
  request: NamePromptRequest | null;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!request) return;
    setValue(request.initial ?? "");
    // Focus after the element exists, so typing can start immediately.
    const id = setTimeout(() => inputRef.current?.select(), 0);
    return () => clearTimeout(id);
  }, [request]);

  if (!request) return null;

  const submit = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    request.onSubmit(trimmed);
    onClose();
  };

  return (
    <div className="name-prompt-backdrop" onMouseDown={onClose}>
      <div className="name-prompt" onMouseDown={(e) => e.stopPropagation()}>
        <label>{request.title}</label>
        <input
          ref={inputRef}
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="settings-actions">
          <button className="btn btn-primary" onClick={submit} disabled={!value.trim()}>
            {request.confirmLabel ?? "Сохранить"}
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
