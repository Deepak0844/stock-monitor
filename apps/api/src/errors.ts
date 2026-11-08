export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthenticated = () =>
  new AppError(401, "unauthenticated", "Please sign in to continue.");
