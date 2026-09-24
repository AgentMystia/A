const COLOR_VALUE =
  /^var\(--color-(foreground(?:-subtle|-subtlest|-inverse)?|primary(?:-foreground)?|secondary|brand|icon-blue|success|warning|destructive|popover|surface|background)\)$/;
const FONT_SIZE_VALUE = /^var\(--text-ui-(xl|lg|base|caption|sm|xs)\)$/;
const LENGTH_VALUE = /^(\d+(?:\.\d+)?|\.\d+)(px|rem|em)$/;

const KEYWORD_PROPERTIES: Record<string, readonly string[]> = {
  "font-style": ["normal", "italic", "oblique"],
  "text-align": ["start", "end", "left", "right", "center", "justify"],
  "white-space": ["normal", "nowrap", "pre", "pre-wrap", "pre-line", "break-spaces"],
  "overflow-wrap": ["normal", "break-word", "anywhere"],
  "word-break": ["normal", "break-all", "keep-all", "break-word"],
  "text-decoration-style": ["solid", "double", "dotted", "dashed", "wavy"],
};

function isBoundedLength(value: string): boolean {
  if (value === "0") {
    return true;
  }
  const match = LENGTH_VALUE.exec(value);
  return Boolean(match) && Number(match?.[1]) <= (match?.[2] === "px" ? 32 : 2);
}

/** 发布包营销富文本只放行这一组声明，避免活动文案把样式注入弹窗。 */
export function isAllowedMarketingStyleDeclaration(property: string, value: string): boolean {
  if (/[\\@!]|\/\*/.test(value)) {
    return false;
  }
  if (
    property === "color" ||
    property === "background-color" ||
    property === "text-decoration-color"
  ) {
    return (
      COLOR_VALUE.test(value) ||
      /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|oklch|oklab|lch|lab)\([\d.,% /+-]+\))$/i.test(value)
    );
  }
  if (property === "font-size") {
    return FONT_SIZE_VALUE.test(value);
  }
  if (property === "font-weight") {
    return (
      /^(normal|bold|bolder|lighter)$/.test(value) ||
      (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 1000)
    );
  }
  if (property === "line-height") {
    return (
      value === "normal" ||
      (/^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 1 && Number(value) <= 3)
    );
  }
  const keywords = KEYWORD_PROPERTIES[property];
  if (keywords) {
    return keywords.includes(value);
  }
  if (property === "text-decoration" || property === "text-decoration-line") {
    const parts = value.split(/\s+/);
    const allowed = ["none", "underline", "overline", "line-through"];
    if (property === "text-decoration") {
      allowed.push("solid", "double", "dotted", "dashed", "wavy");
    }
    return parts.length <= 4 && parts.every((part) => allowed.includes(part));
  }
  if (/^(margin|padding)(-(top|right|bottom|left))?$/.test(property)) {
    const parts = value.split(/\s+/);
    return parts.length <= (property.includes("-") ? 1 : 4) && parts.every(isBoundedLength);
  }
  if (property === "letter-spacing") {
    return value === "normal" || isBoundedLength(value);
  }
  if (property === "text-underline-offset") {
    return value === "auto" || isBoundedLength(value);
  }
  if (property === "text-decoration-thickness") {
    return value === "auto" || value === "from-font" || isBoundedLength(value);
  }
  return false;
}

export function sanitizeMarketingStyle(
  cssText: string | null | undefined,
): Record<string, string> | undefined {
  if (!cssText || typeof document === "undefined") {
    return undefined;
  }
  const probe = document.createElement("span").style;
  probe.cssText = cssText;
  const style: Record<string, string> = {};
  for (let index = 0; index < probe.length; index += 1) {
    const property = probe.item(index);
    const value = probe.getPropertyValue(property).trim();
    if (
      probe.getPropertyPriority(property) ||
      !isAllowedMarketingStyleDeclaration(property, value)
    ) {
      continue;
    }
    style[property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())] = value;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}
