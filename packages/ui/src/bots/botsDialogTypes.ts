export interface BindCodeView {
  botId: string;
  code: string;
  createdAt: number;
  expiresAt: number;
  ttlMs: number;
}

export interface FeishuRegistrationView {
  botId: string;
  deviceCode: string;
  qrUrl: string;
  qrDataUrl: string | null;
  userCode: string;
  interval: number;
  expiresAt: number;
  domain: "feishu" | "lark";
  pollDomain: "feishu" | "lark";
  status: string;
  message?: string;
}

export interface WeixinRegistrationView {
  botId: string;
  qrCode: string;
  qrUrl: string;
  qrDataUrl: string | null;
  interval: number;
  expiresAt: number;
  status: string;
  message?: string;
}

export interface BotNameDraft {
  botId: string;
  value: string;
}
