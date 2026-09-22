declare module "@larksuiteoapi/node-sdk" {
  export class EventDispatcher {
    constructor(options: Record<string, unknown>);
    register(handlers: Record<string, unknown>): void;
  }

  export class WSClient {
    constructor(options: Record<string, unknown>);
    start(options: { eventDispatcher: unknown }): Promise<void>;
    close(): void;
    isConnecting?: boolean;
    wsConfig?: { getWSInstance?: () => { readyState?: number } | undefined };
  }

  export const Domain: { Lark: unknown; Feishu: unknown };
  export const LoggerLevel: { info: unknown };
}
