/** 发布包 host keepNames 常量。 */

export const TELEGRAM_ELSEWHERE_WAIT_MS = 10_000;
export const TELEGRAM_GET_UPDATES_TIMEOUT_MS = 40_000;
export const TELEGRAM_LONG_POLL_SECONDS = 25;
export const BOT_RUNTIME_ERROR_RETRY_MS = 5_000;
export const BOT_CONFLICT_RETRY_MS = 10_000;
export const WEIXIN_GET_UPDATES_TIMEOUT_MS = 90_000;
export const WEIXIN_API_BASE = "https://ilinkai.weixin.qq.com";
export const WEIXIN_BOT_PATH = "/ilink/bot";
export const WEIXIN_CHANNEL_VERSION = "2.0.0";
export const WEIXIN_MESSAGE_TYPE = 2;
export const WEIXIN_MESSAGE_STATE = 2;
export const WEIXIN_AES_ALGORITHM = "aes-128-ecb";
export const WEIXIN_QR_INTERVAL_SECONDS = 3;
export const WEIXIN_QR_EXPIRES_SECONDS = 120;
export const WEIXIN_REGISTRATION_TIMEOUT_MS = 30_000;
export const FEISHU_APP_ID_PATTERN = /^cli_[0-9a-fA-F]{16}$/u;
export const FEISHU_WS_STARTUP_TIMEOUT_MS = 20_000;
export const FEISHU_WS_READY_POLL_MS = 100;
export const FEISHU_WS_OPEN_STATE = 1;
export const FEISHU_ATTACHMENT_TIMEOUT_MS = 30_000;
export const FEISHU_STREAMING_CARD_TAG_LIMIT = 180;
export const FEISHU_TEXT_CHUNK = 1_900;
export const FEISHU_ACCOUNTS_FEISHU = "https://accounts.feishu.cn";
export const FEISHU_ACCOUNTS_LARK = "https://accounts.larksuite.com";
export const FEISHU_REGISTRATION_PATH = "/oauth/v1/app/registration";
export const FEISHU_REGISTRATION_SOURCE = "node-sdk/zcode";
export const FEISHU_OPEN_API = "https://open.feishu.cn";
export const LARK_OPEN_API = "https://open.larksuite.com";
export const FEISHU_RESOLVE_NAME_DELAYS_MS = [0, 800, 1_800] as const;
export const WORKSPACE_REF_CACHE_MS = 5_000;
export const RECONNECT_COOLDOWN_MS = 3_000;
export const INBOUND_DEDUPE_TTL_MS = 2 * 60_000;
/** 发布包 host `II`：机器人草稿与 applyDraft 强制 yolo。 */
export const BOT_FORCED_MODE = "yolo";
/** 发布包 host `Dle`：未指定时的草稿 provider。 */
export const DEFAULT_DRAFT_PROVIDER = "glm";
/** 发布包 host `Hle`：automation 投递跳过日志去重窗口。 */
export const AUTOMATION_DELIVERY_WARN_MS = 5 * 60_000;
/** 发布包 host `Nle`：无 startTyping 时的 sendTyping 间隔。 */
export const BOT_TYPING_INTERVAL_MS = 4_000;
/** 发布包 host `Ule`。 */
export const BOT_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
/** 发布包 host `_H` / `dp` / `jle` / `RH`：elicitation 选项 id。 */
export const BOT_ELICITATION_CUSTOM = "__custom__";
export const BOT_ELICITATION_SUBMIT = "__submit__";
export const BOT_ELICITATION_SKIP = "__skip__";
export const BOT_ELICITATION_FORM_PREFIX = "__form__:";
/** 发布包 host `Ile`。 */
export const BOT_ELICITATION_BROADCAST_TIMEOUT_MS = 1_000;
export const WEBHOOK_SECRET_HEADER = "x-zcode-bot-secret";
export const WEBHOOK_TEST_TYPE = "zcode.bot.test";
export const WEBHOOK_MESSAGE_TYPE = "zcode.bot.message";
export const WEBHOOK_ELICITATION_TYPE = "zcode.bot.elicitation_request";
export const CONNECTION_STATUS_TIMEOUT_MS = 5_000;
export const REMOTE_RUNTIME_TIMEOUT_MS = 60_000;
