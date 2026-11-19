/** Thrown when the Stager AI API answers with a non-2xx status. */
export class StagerApiError extends Error {
  readonly status: number;
  readonly codeKey?: string;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown, codeKey?: string) {
    super(message);
    this.name = "StagerApiError";
    this.status = status;
    this.body = body;
    this.codeKey = codeKey;
  }
}

/** Thrown when an HDR group or AI edit finishes with an error status. */
export class StagerProcessingError extends Error {
  /** Numeric HDR error code (see HdrErrorCode), when there is one. */
  readonly code?: number;
  readonly result: unknown;

  constructor(message: string, result: unknown, code?: number) {
    super(message);
    this.name = "StagerProcessingError";
    this.code = code;
    this.result = result;
  }
}

/** Thrown when a wait*() helper runs out of time. */
export class StagerTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagerTimeoutError";
  }
}
