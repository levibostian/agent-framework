export const EXIT_OK = 0;
export const EXIT_CONFIG = 1;
export const EXIT_USAGE = 2;

/** A failure with a message meant for the user and a process exit code. */
export class AgentError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode: number = EXIT_CONFIG) {
    super(message);
    this.name = "AgentError";
    this.exitCode = exitCode;
  }
}
