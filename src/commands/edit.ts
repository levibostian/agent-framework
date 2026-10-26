import { configFilePath, requireAgentDir } from "../config/load.ts";
import { editorFromEnv, openerFor, spawnEditor } from "../editor.ts";
import type { Paths } from "../paths.ts";

export interface EditOptions {
  paths: Paths;
  name: string;
}

/**
 * Open an agent's directory in the user's editor. The config is never parsed or
 * rewritten, so `edit` works on a broken config — that is usually why you are here.
 */
export async function editCommand(options: EditOptions): Promise<number> {
  const dir = requireAgentDir(options.paths, options.name);

  const editor = editorFromEnv();
  if (editor !== undefined) {
    // Pass the directory: a terminal editor opens its file browser.
    return await spawnEditor({ command: editor.command, args: [...editor.args, dir] });
  }

  // Fallback lands on the config file, because it must be editable.
  return await spawnEditor(openerFor(process.platform, configFilePath(dir)));
}
