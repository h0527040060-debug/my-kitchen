export class HttpError extends Error {
  status: number;
  details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const requireValue = <T>(
  value: T | null | undefined,
  message = "לא נמצא",
): T => {
  if (value == null) throw new HttpError(404, message);
  return value;
};
