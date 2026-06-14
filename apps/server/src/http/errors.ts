export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new HttpError(400, code, message, details);
export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);
export const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid token');
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new HttpError(422, code, message, details);
export const tooLarge = (message: string) => new HttpError(413, 'PAYLOAD_TOO_LARGE', message);
