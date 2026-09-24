import {
  getPermissionRequestPreview,
  type ZCodePermissionOption,
  type ZCodePermissionRequest,
} from "@zcode/shared";
import { formatBotMessage } from "./botsCopy.js";
import {
  formatMarkdownInlineCode,
  isPlainRecord,
  toWorkspaceRelativePath,
  truncateMiddleText,
  truncateText,
  type BotReplyFormatContext,
} from "./botsReplyFormat.js";

const PERMISSION_OPTION_ORDER = {
  allowOnce: 0,
  allowAlways: 1,
  rejectOnce: 2,
  rejectAlways: 3,
  custom: 4,
} as const;

type PermissionOptionKind = keyof typeof PERMISSION_OPTION_ORDER;

/** 发布包 host `getBotPermissionOptionDisplayKind`。 */
export function getBotPermissionOptionDisplayKind(
  option: ZCodePermissionOption,
): PermissionOptionKind {
  const text = `${option.optionId} ${option.kind} ${option.name}`.toLowerCase();
  const persistent =
    /\b(always|persistent|permanent|remember)\b/u.test(text) ||
    /始终|永久|记住|不再询问/u.test(text);
  const allow = /\b(allow|approve|accept|yes)\b/u.test(text) || /允许|同意|批准/u.test(text);
  const reject = /\b(deny|reject|decline|no)\b/u.test(text) || /拒绝|不允许|否/u.test(text);
  if (allow) {
    return persistent ? "allowAlways" : "allowOnce";
  }
  if (reject) {
    return persistent ? "rejectAlways" : "rejectOnce";
  }
  return "custom";
}

/** 发布包 host `sortBotPermissionOptions`。 */
export function sortBotPermissionOptions(
  options: readonly ZCodePermissionOption[],
): ZCodePermissionOption[] {
  return [...options].sort(
    (left, right) =>
      PERMISSION_OPTION_ORDER[getBotPermissionOptionDisplayKind(left)] -
      PERMISSION_OPTION_ORDER[getBotPermissionOptionDisplayKind(right)],
  );
}

/** 发布包 host `formatBotPermissionOptionLabel`。 */
export function formatBotPermissionOptionLabel(
  option: ZCodePermissionOption,
  locale: string | undefined,
): string {
  const kind = getBotPermissionOptionDisplayKind(option);
  if (locale === "en-US") {
    switch (kind) {
      case "allowOnce":
        return "Allow";
      case "allowAlways":
        return "Always Allow";
      case "rejectOnce":
        return "Deny";
      case "rejectAlways":
        return "Always Deny";
      case "custom":
        return option.name;
    }
  }
  switch (kind) {
    case "allowOnce":
      return "允许";
    case "allowAlways":
      return "始终允许";
    case "rejectOnce":
      return "拒绝";
    case "rejectAlways":
      return "始终拒绝";
    case "custom":
      return option.name;
  }
}

/** 发布包 host `isBotPermissionRejectOption`。 */
export function isBotPermissionRejectOption(option: ZCodePermissionOption): boolean {
  const kind = getBotPermissionOptionDisplayKind(option);
  return kind === "rejectOnce" || kind === "rejectAlways";
}

/** 发布包 host `formatBotPermissionOptionDescription`。 */
export function formatBotPermissionOptionDescription(
  option: ZCodePermissionOption,
  request: ZCodePermissionRequest,
  locale: string | undefined,
): string {
  const kind = getBotPermissionOptionDisplayKind(option);
  if (kind === "custom") {
    return option.kind;
  }
  const scope = getPermissionRequestPreview(request).scope;
  if (locale === "en-US") {
    if (kind === "allowOnce") {
      return "Allow this time only";
    }
    if (kind === "rejectOnce") {
      return "Reject this time";
    }
    if (kind === "allowAlways") {
      return scope === "command"
        ? "Do not ask again for the same command"
        : scope === "file"
          ? "Do not ask again for the same file operation"
          : "Do not ask again for the same permission request";
    }
    return scope === "command"
      ? "Always reject the same command"
      : scope === "file"
        ? "Always reject the same file operation"
        : "Always reject the same permission request";
  }
  if (kind === "allowOnce") {
    return "仅允许这一次";
  }
  if (kind === "rejectOnce") {
    return "这次先拒绝";
  }
  if (kind === "allowAlways") {
    return scope === "command"
      ? "后续相同命令不再询问"
      : scope === "file"
        ? "后续相同文件操作不再询问"
        : "后续相同权限请求不再询问";
  }
  return scope === "command"
    ? "后续相同命令也会直接拒绝"
    : scope === "file"
      ? "后续相同文件操作也会直接拒绝"
      : "后续相同权限请求也会直接拒绝";
}

/** 发布包 host `formatEditPermissionKindLabel`。 */
function formatEditPermissionKindLabel(
  request: ZCodePermissionRequest,
  preview: ReturnType<typeof getPermissionRequestPreview>,
  locale: string | undefined,
): string {
  const rawKind =
    isPlainRecord(request.raw) && typeof request.raw.kind === "string"
      ? request.raw.kind
      : undefined;
  const rawTitle =
    isPlainRecord(request.raw) && typeof request.raw.title === "string"
      ? request.raw.title
      : undefined;
  const text = [request.title, request.description, rawKind, rawTitle]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .trim()
    .toLowerCase();
  if (/\b(delete|deleted|remove|removed|erase|erased|unlink|rm)\b/u.test(text)) {
    return formatBotMessage(locale, "editDeleting");
  }
  if (
    preview.fileChange?.type === "add" ||
    /\b(write|wrote|create|created|add|added|save|saved|new)\b/u.test(text)
  ) {
    return formatBotMessage(locale, "editWriting");
  }
  if (/\b(update|updating|updated)\b/u.test(text)) {
    return formatBotMessage(locale, "editUpdating");
  }
  return formatBotMessage(locale, "editEditing");
}

function formatPermissionRequestTitle(
  request: ZCodePermissionRequest,
  preview: ReturnType<typeof getPermissionRequestPreview>,
  context?: BotReplyFormatContext,
): string {
  if (request.kind !== "edit" || (preview.scope !== "file" && preview.fileChanges.length === 0)) {
    return preview.title;
  }
  const label = formatEditPermissionKindLabel(request, preview, context?.locale);
  const stripped = preview.title.replace(/^edit\b[:：]?\s*/iu, "").trim();
  const path =
    stripped && stripped !== preview.title
      ? stripped
      : preview.filePaths.length === 1 || preview.fileChanges.length === 1
        ? toWorkspaceRelativePath(
            preview.filePaths[0] ?? preview.fileChanges[0]?.path ?? "",
            context?.workspacePath,
          )
        : "";
  return path ? `${label} ${path}` : label;
}

/** 发布包 host `formatBotPermissionRequestSummary`。 */
export function formatBotPermissionRequestSummary(
  request: ZCodePermissionRequest,
  context?: BotReplyFormatContext,
): string {
  const preview = getPermissionRequestPreview(request);
  const header = `${formatBotMessage(context?.locale, "permissionRequired")}\n${formatPermissionRequestTitle(request, preview, context)}`;
  if (preview.command) {
    return `${header}\n${formatMarkdownInlineCode(truncateMiddleText(preview.command))}`;
  }
  const paths =
    preview.filePaths.length > 0 ? preview.filePaths : preview.fileChanges.map((file) => file.path);
  if (paths.length > 0) {
    const listed = paths
      .slice(0, 3)
      .map((filePath) => toWorkspaceRelativePath(filePath, context?.workspacePath))
      .map((filePath) => formatMarkdownInlineCode(filePath))
      .join(", ");
    return `${header}\n${truncateText(listed)}`;
  }
  return header;
}
