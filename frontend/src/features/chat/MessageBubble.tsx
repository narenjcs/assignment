import type { ReactElement } from 'react';

import type { ChatMessage } from './useChatStream';

export interface MessageBubbleProps {
  message: ChatMessage;
}

const ROLE_CLASSES: Record<ChatMessage['role'], string> = {
  user: 'ml-auto bg-accent text-white',
  assistant: 'mr-auto bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  note: 'mr-auto bg-transparent text-slate-400 italic',
  error: 'mr-auto bg-state-failed/10 text-state-failed',
};

/** One chat bubble: user turn, streamed assistant reply, or an inline status/tool note. */
export function MessageBubble({ message }: MessageBubbleProps): ReactElement {
  if (message.role === 'note') {
    return (
      <p role="status" className={`max-w-[85%] rounded px-2 py-1 text-xs ${ROLE_CLASSES.note}`}>
        {message.text}
      </p>
    );
  }
  return (
    <p
      className={`max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${ROLE_CLASSES[message.role]}`}
    >
      {message.text || ' '}
    </p>
  );
}
