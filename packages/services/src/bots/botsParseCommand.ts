export type ParsedBotCommand =
  | { type: "message"; text: string }
  | { type: "selection.cancel" }
  | { type: "bind"; code: string }
  | { type: "help" }
  | { type: "status" }
  | { type: "new" }
  | { type: "reconnect" }
  | { type: "workspace.list" }
  | { type: "workspace.set"; value: string }
  | { type: "model.list" }
  | { type: "model.set"; value: string }
  | { type: "model.provider.set"; value: string }
  | { type: "mode.list" }
  | { type: "mode.set"; value: string }
  | { type: "thoughtLevel.list" }
  | { type: "thoughtLevel.set"; value: string }
  | { type: "task.list" }
  | { type: "task.set"; value: string }
  | { type: "reply.list" }
  | { type: "reply.set"; value: string }
  | { type: "stop" }
  | { type: "permission.respond"; value: string }
  | { type: "elicitation.submit" }
  | { type: "elicitation.respond"; value: string }
  | { type: "approve"; requestId: string; optionId: string }
  | { type: "deny"; requestId: string }
  | { type: "unknown"; name: string; raw: string };

const ELICITATION_SUBMIT = new Set(["submit", "done", "完成", "提交"]);

export function splitCommand(text: string): { name: string; rest: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const body = trimmed.slice(1);
  const space = body.search(/\s/u);
  if (space === -1) {
    return { name: body.toLowerCase(), rest: "" };
  }
  return { name: body.slice(0, space).toLowerCase(), rest: body.slice(space + 1).trim() };
}

export function parseBotCommand(text: string): ParsedBotCommand {
  const command = splitCommand(text);
  if (!command) {
    return text.trim() === "0" ? { type: "selection.cancel" } : { type: "message", text };
  }
  const { name, rest } = command;
  switch (name) {
    case "bind":
      return rest ? { type: "bind", code: rest } : { type: "unknown", name, raw: text };
    case "help":
    case "帮助":
      return { type: "help" };
    case "cancel":
    case "取消":
      return { type: "selection.cancel" };
    case "status":
    case "状态":
      return { type: "status" };
    case "new":
    case "clear":
    case "新建":
      return { type: "new" };
    case "reconnect":
    case "重连":
      return { type: "reconnect" };
    case "workspace":
    case "project":
    case "项目":
      return rest ? { type: "workspace.set", value: rest } : { type: "workspace.list" };
    case "model":
    case "模型":
      if (!rest) {
        return { type: "model.list" };
      }
      if (rest.startsWith("provider ")) {
        return { type: "model.provider.set", value: rest.slice(9).trim() };
      }
      if (rest.startsWith("model ")) {
        return { type: "model.set", value: rest.slice(6).trim() };
      }
      return { type: "model.set", value: rest };
    case "mode":
    case "模式":
      return rest ? { type: "mode.set", value: rest } : { type: "mode.list" };
    case "thoughtlevel":
    case "thought_level":
    case "thought-level":
    case "think":
    case "思考":
      return rest ? { type: "thoughtLevel.set", value: rest } : { type: "thoughtLevel.list" };
    case "task":
      return rest ? { type: "task.set", value: rest } : { type: "task.list" };
    case "reply":
    case "回复":
      return rest ? { type: "reply.set", value: rest } : { type: "reply.list" };
    case "stop":
    case "停止":
      return { type: "stop" };
    case "permission":
      return rest ? { type: "permission.respond", value: rest } : { type: "unknown", name, raw: text };
    case "elicitation":
    case "answer":
    case "回答":
      if (!rest) {
        return { type: "unknown", name, raw: text };
      }
      return ELICITATION_SUBMIT.has(rest.toLowerCase())
        ? { type: "elicitation.submit" }
        : { type: "elicitation.respond", value: rest };
    case "approve": {
      const [requestId, optionId] = rest.split(/\s+/u);
      return requestId && optionId
        ? { type: "approve", requestId, optionId }
        : { type: "unknown", name, raw: text };
    }
    case "deny":
      return rest ? { type: "deny", requestId: rest } : { type: "unknown", name, raw: text };
    default:
      return { type: "unknown", name, raw: text };
  }
}
