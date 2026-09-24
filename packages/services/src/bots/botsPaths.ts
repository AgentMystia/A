/** 发布包 host BotsRepo 文件名。 */
export const BOT_CONFIG_V3_FILE_NAME = "bot-config.v3.json";
export const BOT_CONFIG_LEGACY_FILE_NAME = "bot-config.json";
export const BOT_STATE_V3_FILE_NAME = "bot-state.v3.json";
export const BOT_STATE_V2_FILE_NAME = "bot-state.v2.json";
export const BOT_STATE_LEGACY_FILE_NAME = "bot-state.json";
export const BOT_CREDENTIAL_KEY_PREFIX = "bot";
export const BOT_RUNTIME_LOCKS_DIRECTORY_NAME = "bots-runtime-locks";

export const TELEGRAM_COMMAND_ORDER = [
  "help",
  "status",
  "new",
  "workspace",
  "model",
  "mode",
  "thoughtLevel",
  "reply",
  "bind",
] as const;

export const TELEGRAM_COMMAND_NAMES: Record<(typeof TELEGRAM_COMMAND_ORDER)[number], string> = {
  help: "help",
  status: "status",
  new: "new",
  workspace: "project",
  model: "model",
  mode: "mode",
  thoughtLevel: "think",
  reply: "reply",
  bind: "bind",
};

export const TELEGRAM_COMMAND_DESCRIPTIONS: Record<(typeof TELEGRAM_COMMAND_ORDER)[number], string> =
  {
    help: "Show help",
    status: "Show current status",
    new: "Create a new task",
    workspace: "Select project",
    model: "Select model",
    mode: "Select mode",
    thoughtLevel: "Select thinking level",
    reply: "Select reply detail",
    bind: "Bind this chat",
  };

export const HELP_COPY_KEYS: Record<
  "help" | "bind" | "status" | "new" | "workspace" | "model" | "mode" | "thoughtLevel" | "reply",
  | "helpHelp"
  | "helpBind"
  | "helpStatus"
  | "helpNew"
  | "helpWorkspace"
  | "helpModel"
  | "helpMode"
  | "helpThoughtLevel"
  | "helpReply"
> = {
  help: "helpHelp",
  bind: "helpBind",
  status: "helpStatus",
  new: "helpNew",
  workspace: "helpWorkspace",
  model: "helpModel",
  mode: "helpMode",
  thoughtLevel: "helpThoughtLevel",
  reply: "helpReply",
};
