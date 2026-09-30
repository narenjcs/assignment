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
  /** Emit one CloudWatch Embedded Metric Format record. Dimensions must be low-cardinality. */
  metric: (name: string, value: number, dimensions?: Record<string, string>) => void;
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

function emitMetric(
  service: string,
  name: string,
  value: number,
  dimensions: Record<string, string>,
): void {
  const dimensionNames = Object.keys(dimensions);
  // Do not add requestId/jobId here: CloudWatch metric dimensions must remain low-cardinality.
  console.log(
    JSON.stringify({
      ...dimensions,
      [name]: value,
      _aws: {
        Timestamp: Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: 'DocIntel',
            Dimensions: [['service', ...dimensionNames]],
            Metrics: [{ Name: name, Unit: 'Count' }],
          },
        ],
      },
      service,
    }),
  );
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
    metric: (name, value, dimensions = {}) => emitMetric(service, name, value, dimensions),
  };
}
