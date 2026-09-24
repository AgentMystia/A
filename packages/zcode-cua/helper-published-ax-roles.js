// 发布包把角色映射放在 mkdtemp 残留后面。这里没有 flattener 实现。
// 原生绑定路径在后面的 helper-published-ax-native.js，不写在这张表里。

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
