import { join } from "node:path";

// 发布包把角色映射放在 mkdtemp 残留后面。这里没有 flattener 实现。

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
