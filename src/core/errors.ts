export type ErrorCode = 'not-an-image' | 'decode-failed' | 'unsupported-format' | 'too-large' | 'encode-failed' | 'internal';

export const ERROR_CODES: readonly ErrorCode[] = ['not-an-image', 'decode-failed', 'unsupported-format', 'too-large', 'encode-failed', 'internal'];

/** An expected failure with a stable code, sent in the worker reply. Each code has the i18n key `error.<code>`. */
export class CoreError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'CoreError';
    this.code = code;
  }
}

function hasCode(error: unknown): error is { code: ErrorCode } {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return typeof code === 'string' && (ERROR_CODES as readonly string[]).includes(code);
}

/** The code of a CoreError, or of any error that carries a known code (the EngineError of the app). Else 'internal'. */
export function errorCode(error: unknown): ErrorCode {
  return hasCode(error) ? error.code : 'internal';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
