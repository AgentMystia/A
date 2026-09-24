import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  buildRuntimeZCodeApiUrl,
  marketingTouchActionSchema,
  marketingTouchLocaleSchema,
  parseMarketingTouchResponse,
  type ApiClient,
  type MarketingTouchAction,
  type MarketingTouchLocale,
  type MarketingTouchQueryResult,
  type MarketingTouchSnapshot,
} from "@zcode/shared";
import { readApiJson } from "../providers/api/apiJson.js";
import type { IMarketingTouchService } from "./marketingTouch.js";

export interface CreateMarketingTouchServiceOptions {
  apiClient: ApiClient;
  getToken: () => Promise<string | null>;
  getDeviceMid: () => string | undefined;
  appVersion: string;
  baseUrl?: string;
  onSnapshot?: (snapshot: MarketingTouchSnapshot) => void;
}

let marketingTouchSeq = 0;

export function createMarketingTouchService(
  options: CreateMarketingTouchServiceOptions,
): IMarketingTouchService {
  let tokenScope = "";
  let identityScope = randomUUID();

  async function context(locale: MarketingTouchLocale): Promise<{
    scope: string;
    headers: Record<string, string>;
  }> {
    const token = (await options.getToken())?.trim() || "";
    if (tokenScope !== token) {
      tokenScope = token;
      identityScope = randomUUID();
    }
    return {
      scope: identityScope,
      headers: {
        "X-Device-Mid": z.string().uuid().parse(options.getDeviceMid()),
        "X-Client-Language": marketingTouchLocaleSchema.parse(locale),
        "X-ZCode-App-Version": options.appVersion,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
  }

  return {
    async query({ locale }): Promise<MarketingTouchQueryResult> {
      const started = await context(locale);
      const url = new URL(
        "/api/v1/marketing/touch",
        options.baseUrl ?? buildRuntimeZCodeApiUrl(process.env, "/"),
      );
      url.searchParams.set("seq", String(marketingTouchSeq++));
      const payload = await readApiJson(options.apiClient, url.href, {
        method: "GET",
        headers: started.headers,
        timeoutMs: 15_000,
        redirect: "error",
      });
      if ((await context(locale)).scope !== started.scope) {
        throw new Error("marketing_identity_changed");
      }
      const snapshot = parseMarketingTouchResponse(payload);
      options.onSnapshot?.(snapshot);
      return { ...snapshot, scope: started.scope };
    },
    async report(request: MarketingTouchAction): Promise<void> {
      const action = marketingTouchActionSchema.parse(request);
      const started = await context(action.locale);
      if (started.scope !== action.scope) {
        throw new Error("marketing_identity_changed");
      }
      const payload = await readApiJson(
        options.apiClient,
        new URL(
          "/api/v1/marketing/touch/action",
          options.baseUrl ?? buildRuntimeZCodeApiUrl(process.env, "/"),
        ).href,
        {
          method: "POST",
          headers: {
            ...started.headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            campaign_id: action.campaignId,
            action_type: action.actionType,
          }),
          timeoutMs: 15_000,
          redirect: "error",
        },
      );
      z.object({ code: z.literal(0) }).parse(payload);
    },
  };
}
