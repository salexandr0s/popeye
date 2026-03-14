import { type Writable } from 'node:stream';

import pino from 'pino';

import { redactText } from './index.js';

export interface CorrelationIds {
  workspaceId?: string;
  projectId?: string;
  taskId?: string;
  jobId?: string;
  runId?: string;
  sessionRootId?: string;
}

export interface PopeyeLogger {
  info(msg: string, details?: Record<string, unknown>): void;
  warn(msg: string, details?: Record<string, unknown>): void;
  error(msg: string, details?: Record<string, unknown>): void;
  debug(msg: string, details?: Record<string, unknown>): void;
  child(ids: CorrelationIds): PopeyeLogger;
}

function redactDetails(
  details: Record<string, unknown>,
  customPatterns: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string') {
      result[key] = redactText(value, customPatterns).text;
    } else {
      result[key] = value;
    }
  }
  return result;
}

function wrapPino(base: pino.Logger, customPatterns: string[]): PopeyeLogger {
  const redact = (msg: string): string => redactText(msg, customPatterns).text;

  return {
    info(msg, details) {
      if (details) base.info(redactDetails(details, customPatterns), redact(msg));
      else base.info(redact(msg));
    },
    warn(msg, details) {
      if (details) base.warn(redactDetails(details, customPatterns), redact(msg));
      else base.warn(redact(msg));
    },
    error(msg, details) {
      if (details) base.error(redactDetails(details, customPatterns), redact(msg));
      else base.error(redact(msg));
    },
    debug(msg, details) {
      if (details) base.debug(redactDetails(details, customPatterns), redact(msg));
      else base.debug(redact(msg));
    },
    child(ids) {
      return wrapPino(base.child(ids), customPatterns);
    },
  };
}

export interface CreateLoggerOptions {
  customPatterns?: string[];
  destination?: Writable;
}

export function createLogger(
  component: string,
  customPatternsOrOptions?: string[] | CreateLoggerOptions,
): PopeyeLogger {
  const opts: CreateLoggerOptions = Array.isArray(customPatternsOrOptions)
    ? { customPatterns: customPatternsOrOptions }
    : customPatternsOrOptions ?? {};

  const level = process.env.POPEYE_LOG_LEVEL ?? 'info';
  const base = opts.destination
    ? pino({ name: component, level }, opts.destination)
    : pino({ name: component, level });
  return wrapPino(base, opts.customPatterns ?? []);
}
