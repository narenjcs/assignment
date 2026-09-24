import type { ReactElement } from 'react';

import { EmptyState } from '../../components/EmptyState';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from './useChatStream';

export interface ChatMessageListProps {
  messages: ChatMessage[];
}

/** Scrollable, live-updating transcript for ChatPanel. */
export function ChatMessageList({ messages }: ChatMessageListProps): ReactElement {
  if (messages.length === 0) {
    return (
      <EmptyState title="Ask a question" description="Start a conversation about this document." />
    );
  }
  return (
    <div className="scroll-panel min-h-0 flex-1 space-y-2" aria-live="polite">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
    </div>
  );
}
