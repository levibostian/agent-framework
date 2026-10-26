/** A fully resolved agent. The entire interface between the spec layer and a runtime. */
export interface ResolvedAgent {
  name: string;
  /** Absolute path to the agent directory. */
  dir: string;
  description?: string;
  /** Empty string when neither `system` nor `system-cmd` was given. */
  systemPrompt: string;
  systemPromptSource: "config" | "command" | "none";
  /** `undefined` means the runtime's default tool set; `[]` means no tools. */
  tools?: string[];
  /** Absolute paths, `~` expanded. Empty when unconfigured. */
  skills: string[];
  /** Literal model id; templates already resolved. */
  model: string;
}

export interface RunRequest {
  agent: ResolvedAgent;
  /** Absent means interactive mode. */
  prompt?: string;
}

/** Binds the spec to one runtime. The only place runtime names may appear. */
export interface Runner {
  /** One line of shell-escaped argv that `run` would spawn. */
  describe(request: RunRequest): string;
  /** Execute the request and resolve to the process exit code. */
  run(request: RunRequest): Promise<number>;
}
