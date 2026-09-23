// Only file allowed to call `console` (see DEVELOPMENT.md §3, §12 and eslint.config.js override).
// One JSON object per line: { ts, level, service, jobId?, sessionId?, requestId?, event, msg, ...fields }.
// Never log document text, tokens, or secrets.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  jobId?: string;
  sessionId?: string;
  requestId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug: (event: string, msg: string, fields?: LogFields) => void;
  info: (event: string, msg: string, fields?: LogFields) => void;
  warn: (event: string, msg: string, fields?: LogFields) => void;
  error: (event: string, msg: string, fields?: LogFields) => void;
}

interface LogRecord {
  level: LogLevel;
  service: string;
  event: string;
  msg: string;
  fields: LogFields;
}

function emit(record: LogRecord): void {
  const { level, service, event, msg, fields } = record;
  const line = { ts: new Date().toISOString(), level, service, event, msg, ...fields };
  console.log(JSON.stringify(line));
}

/** Creates a logger bound to a single service name (e.g. "api", "s3-trigger", "mcp-tools"). */
export function createLogger(service: string): Logger {
  const at =
    (level: LogLevel) =>
    (event: string, msg: string, fields: LogFields = {}): void =>
      emit({ level, service, event, msg, fields });
  return {
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  };
}
