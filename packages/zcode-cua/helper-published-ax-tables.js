// 发布包 main paths、host index、scheduler index 都有这些未调用的 AX 常量。
// Object.freeze / new Set 是副作用，catalog 的 side-effect import 才会把它们留在这三条链上。
// 这里没有 flattener 实现，也不是第二套 Helper 安装器。

export const PUBLISHED_A11Y_FLATTENER_NAMES = Object.freeze([
  "associateTitleUIElements",
  "flattenIntoSelectableAncestor",
  "pruneEmptyDisabledElements",
  "mergeSingleItemGroups",
  "flattenRepetitiveStaticText",
  "flattenLinksIntoMarkdownText",
]);

export const PUBLISHED_AX_TEXT_ROLES = new Set([
  "textfield",
  "textarea",
  "searchfield",
  "securefield",
  "combobox",
]);

export const PUBLISHED_AX_TEXT_AND_SLIDER_ROLES = new Set([
  ...PUBLISHED_AX_TEXT_ROLES,
  "slider",
  "stepper",
]);

export const PUBLISHED_KEY_NAMES = new Set([
  ..."abcdefghijklmnopqrstuvwxyz0123456789".split(""),
  "=",
  "*",
  "-",
  "]",
  "[",
  "'",
  ";",
  "\\",
  ",",
  "/",
  ".",
  "`",
  "enter",
  "tab",
  "space",
  "backspace",
  "delete",
  "esc",
  "command",
  "meta",
  "super",
  "win",
  "shift",
  "capslock",
  "alt",
  "ctrl",
  "help",
  "home",
  "pageup",
  "forwarddelete",
  "end",
  "pagedown",
  "left",
  "right",
  "down",
  "up",
  ...Array.from({ length: 16 }, (_value, index) => `f${index + 1}`),
]);
