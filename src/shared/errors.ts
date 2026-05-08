export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly fatal: boolean = true,
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

export type Result<T, E = PipelineError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
