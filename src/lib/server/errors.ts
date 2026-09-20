export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown, public retryAfter?: number) { super(message); }
}
