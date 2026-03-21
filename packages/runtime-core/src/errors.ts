export class RuntimeNotFoundError extends Error {
  readonly errorCode = 'not_found';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeNotFoundError';
  }
}

export class RuntimeConflictError extends Error {
  readonly errorCode = 'conflict';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeConflictError';
  }
}

export class RuntimeValidationError extends Error {
  readonly errorCode = 'invalid_input';

  constructor(message: string) {
    super(message);
    this.name = 'RuntimeValidationError';
  }
}
