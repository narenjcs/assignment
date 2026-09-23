import type { ReactElement } from 'react';

import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Spinner } from '../../components/Spinner';
import type { Job } from '../../types/job';
import { ChatComposer } from './ChatComposer';
import { ChatMessageList } from './ChatMessageList';
import { useChatStream } from './useChatStream';

export interface ChatPanelProps {
  job: Job | null;
}

/** Chat about a job's document. Disabled until the job reaches COMPLETED (PLAN §2.6 /chat). */
export function ChatPanel({ job }: ChatPanelProps): ReactElement {
  const isReady = job?.status === 'COMPLETED';
  const { messages, isStreaming, error, sendMessage } = useChatStream(isReady ? job.jobId : null);

  return (
    <Card title="Chat">
      {!isReady && (
        <EmptyState
          title="Chat unavailable"
          description="Finish processing a document to ask questions about it."
        />
      )}

      {isReady && (
        <div className="flex h-80 flex-col gap-3">
          <ChatMessageList messages={messages} />
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {isStreaming && <Spinner label="Thinking" />}
          <ChatComposer onSend={(text) => void sendMessage(text)} disabled={isStreaming} />
        </div>
      )}
    </Card>
  );
}
