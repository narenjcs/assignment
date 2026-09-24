import {
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import { formatBytes } from '../lib/format';
import { hasAcceptedExtension, INVALID_FILE_TYPE_MESSAGE } from '../lib/fileValidation';

export interface DropzoneProps {
  file: File | null;
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

function openPicker(disabled: boolean, inputRef: RefObject<HTMLInputElement | null>): void {
  if (!disabled) inputRef.current?.click();
}

function onKeyDown(
  event: KeyboardEvent<HTMLDivElement>,
  disabled: boolean,
  inputRef: RefObject<HTMLInputElement | null>,
): void {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openPicker(disabled, inputRef);
  }
}

interface PickDeps {
  onFileSelected: (file: File) => void;
  setError: (message: string | null) => void;
}

function pickFile(candidate: File | undefined, deps: PickDeps): void {
  if (!candidate) return;
  if (!hasAcceptedExtension(candidate.name)) {
    deps.setError(INVALID_FILE_TYPE_MESSAGE);
    return;
  }
  deps.setError(null);
  deps.onFileSelected(candidate);
}

function onDragOver(
  event: DragEvent<HTMLDivElement>,
  disabled: boolean,
  setIsDragOver: (value: boolean) => void,
): void {
  event.preventDefault();
  if (!disabled) setIsDragOver(true);
}

function zoneClasses(isDragOver: boolean, disabled: boolean): string {
  const base =
    'flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-6 text-center';
  const tone = isDragOver
    ? 'border-accent bg-accent/5'
    : 'border-slate-300 dark:border-slate-700';
  const disabledTone = disabled ? 'cursor-not-allowed opacity-50' : '';
  return `${base} ${tone} ${disabledTone}`;
}

/** Drag-and-drop + click-to-browse file picker, restricted to .pdf/.docx, keyboard operable. */
export function Dropzone({ file, onFileSelected, disabled = false }: DropzoneProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const deps: PickDeps = { onFileSelected, setError };

  const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setIsDragOver(false);
    if (!disabled) pickFile(event.dataTransfer.files[0], deps);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    pickFile(event.target.files?.[0], deps);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-label="Choose or drop a .pdf or .docx file to upload"
        onClick={() => openPicker(disabled, inputRef)}
        onKeyDown={(event) => onKeyDown(event, disabled, inputRef)}
        onDragOver={(event) => onDragOver(event, disabled, setIsDragOver)}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={zoneClasses(isDragOver, disabled)}
      >
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          {file ? file.name : 'Drag a .pdf or .docx here, or click to browse'}
        </p>
        {file && <p className="text-xs text-slate-400">{formatBytes(file.size)}</p>}
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx"
          className="sr-only"
          disabled={disabled}
          onChange={handleChange}
        />
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-state-failed">
          {error}
        </p>
      )}
    </div>
  );
}
