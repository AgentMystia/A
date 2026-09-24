import { join } from "node:path";

import "./helper-published-ax-tables.js";
// 键页必须单独成模块，否则会被并进按键集那条语句，发不出 `var x=64,y=x*x`。
import "./helper-published-ax-page.js";
// 键页常量结束之后才是这三份临时文件残留，不能写进 ax-tables，否则会被抬到键集前面。
import "./helper-published-temp-scan.js";
import "./helper-published-temp-read.js";
import "./helper-published-temp-limit.js";
// 128MiB 上限和它前面的 execFileSync / platform 必须是独立模块，不能并进方法表。
import "./helper-published-temp-spawn.js";
import "./helper-published-ceiling-imports.js";
import "./helper-published-byte-ceiling.js";
import "./helper-published-ax-roles.js";
// 原生绑定路径和它后面的空 import 在角色映射之后、PiP schema 之前。
import "./helper-published-ax-native.js";
import "./helper-published-temp-fs.js";
import "./helper-published-temp-require.js";
import "./pip-session-schema.js";

// 发布包在加载 CuaHelperError 的同一条链上保留这些常量。
// main、host、scheduler 都有；它们不是第二套 Host。

export const PROJECT_CONFIG_FILES = ["zcode.json", join(".zcode", "config.json")];

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
