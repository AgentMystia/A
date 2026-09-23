import { join } from "node:path";

// 发布包在加载 CuaHelperError 的同一条链上保留这些常量。
// main、host、scheduler 都有；它们不是第二套 Host。

export const PROJECT_CONFIG_FILES = ["zcode.json", join(".zcode", "config.json")];

const BROKER_METHODS = [
  "broker_info",
  "controller_status",
  "controller_takeover",
  "controller_stop",
  "request_access",
  "permission_status",
  "input_permission_status",
  "screen_capture_status",
  "screen_capture_probe",
  "supports_accessibility",
  "list_applications",
  "application_info",
  "list_windows",
  "capture_app",
  "element_at_point",
  "read_element",
  "click",
  "scroll",
  "drag",
  "type_text",
  "type_text_to_app",
  "press_key",
  "press_key_to_app",
  "hold_key",
  "hold_key_to_app",
  "cancel_input_holds",
  "element_press",
  "element_show_menu",
  "element_focus",
  "element_set_value",
  "element_perform_action",
  "element_select_text",
  "paste",
  "prevent_activation",
  "reenable_activation",
  "is_focus_steal_prevented",
  "pip_start",
  "pip_stop",
  "pip_is_running",
  "pip_clear_dismissed",
  "pip_session_handshake",
  "pip_session_event",
];

export const BROKER_METHOD_SET = new Set(BROKER_METHODS);
export const BROKER_MAX_FRAME_BYTES = 16 * 1024 * 1024;

const BROKER_NOT_ACCEPTING = "broker_not_accepting";
const PERMISSION_REFRESH_IN_PROGRESS = "permission_refresh_in_progress";
const PERMISSION_REFRESH_INVALID = "permission_refresh_invalid";
const BROKER_RESPONSE_AMBIGUOUS = "broker_response_ambiguous";
const CALLER_TIMEOUT = "caller_timeout";
const RESTART_DEFERRED_ACTIVE_TURN = "restart_deferred_active_turn";

export const RETRYABLE_BROKER_CODES = Object.freeze({
  [BROKER_NOT_ACCEPTING]: true,
  [PERMISSION_REFRESH_IN_PROGRESS]: true,
  [PERMISSION_REFRESH_INVALID]: false,
  [BROKER_RESPONSE_AMBIGUOUS]: false,
  [CALLER_TIMEOUT]: true,
  [RESTART_DEFERRED_ACTIVE_TURN]: true,
});

export const BROKER_RECOVERY_CODES = Object.freeze([
  BROKER_NOT_ACCEPTING,
  PERMISSION_REFRESH_IN_PROGRESS,
  PERMISSION_REFRESH_INVALID,
  BROKER_RESPONSE_AMBIGUOUS,
  CALLER_TIMEOUT,
  RESTART_DEFERRED_ACTIVE_TURN,
]);

const BROKER_NOT_ACCEPTING_MESSAGE =
  "The ZCode Computer Use is starting up and its permission broker socket is not accepting connections yet. Retry the same tool call after a brief wait.";
const BROKER_RESPONSE_AMBIGUOUS_MESSAGE =
  "The Helper may have accepted this action, but its response was lost. Do not replay it automatically; observe the target state first.";
const PERMISSION_REFRESH_IN_PROGRESS_MESSAGE =
  "ZCode is still refreshing the permission Helper. Retry after the refresh finishes.";
const PERMISSION_REFRESH_INVALID_MESSAGE =
  "ZCode's permission refresh marker is invalid or unsafe. ZCode must recreate the marker in its private runtime directory.";

export const BROKER_RECOVERY_MESSAGES = Object.freeze({
  broker_not_accepting: BROKER_NOT_ACCEPTING_MESSAGE,
  broker_response_ambiguous: BROKER_RESPONSE_AMBIGUOUS_MESSAGE,
  permission_refresh_in_progress: PERMISSION_REFRESH_IN_PROGRESS_MESSAGE,
  permission_refresh_invalid: PERMISSION_REFRESH_INVALID_MESSAGE,
});
