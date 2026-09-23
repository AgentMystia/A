import { join } from "node:path";

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

// 发布包单独留着 `var bd=64,vte=bd*bd`，没有其它引用。
// const 会被当成纯绑定删掉；var 会留在这条 side-effect 链上。void 只给 lint 一个引用，打包时会去掉。
var publishedKeyPage = 64;
var publishedKeyPageArea = publishedKeyPage * publishedKeyPage;
void publishedKeyPageArea;

export const PUBLISHED_AX_ROLE_MAP = Object.freeze({
  Button: "button",
  SplitButton: "button",
  MenuItem: "menuitem",
  Menu: "menuitem",
  MenuBar: "menuitem",
  Edit: "textfield",
  Document: "textarea",
  Password: "securefield",
  ComboBox: "combobox",
  CheckBox: "checkbox",
  RadioButton: "radio",
  Hyperlink: "link",
  Slider: "slider",
  ProgressBar: "slider",
  Text: "text",
  StatusBar: "text",
  Image: "image",
  ListItem: "row",
  DataItem: "row",
  TreeItem: "row",
  TabItem: "tab",
  Custom: "",
  Pane: "",
  Window: "",
  Group: "",
});

export const PUBLISHED_AX_VALUE_ROLES = new Set([
  "textfield",
  "textarea",
  "securefield",
  "combobox",
]);

export const PUBLISHED_AX_VALUE_AND_SLIDER_ROLES = new Set([
  ...PUBLISHED_AX_VALUE_ROLES,
  "slider",
  "stepper",
]);

export const PUBLISHED_DESKTOP_APP_IDS = Object.freeze(["dev.zcode.app", "dev.zcode.app.preview"]);

// 发布包只留下 join 的结果。createRequire / existsSync 那组未使用的 import 会被当前 esbuild 删掉。
export const PUBLISHED_AX_NATIVE_BINDING = join("build", "Release", "ax_native.node");
