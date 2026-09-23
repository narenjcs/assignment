import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';

export interface ChatComposerProps {
  onSend: (text: string) => void;
  disabled: boolean;
}

/** Text input + send button for the chat panel; owns its own draft state. */
export function ChatComposer({ onSend, disabled }: ChatComposerProps): ReactElement {
  const [draft, setDraft] = useState('');

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = draft.trim();
    if (disabled || !trimmed) return;
    setDraft('');
    onSend(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <label htmlFor="chat-input" className="sr-only">
        Message
      </label>
      <input
        id="chat-input"
        type="text"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={disabled}
        placeholder="Ask about this document…"
        className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"
      />
      <button
        type="submit"
        disabled={disabled || !draft.trim()}
        aria-label="Send message"
        className="rounded-md bg-brand-aws px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        Send
      </button>
    </form>
  );
}
