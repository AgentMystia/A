import {
  ServiceChannels,
  type MarketingTouchAction,
  type MarketingTouchLocale,
  type MarketingTouchQueryResult,
} from "@zcode/shared";
import { createServiceDescriptor } from "../descriptors.js";

export interface IMarketingTouchService {
  query(request: { locale: MarketingTouchLocale }): Promise<MarketingTouchQueryResult>;
  report(request: MarketingTouchAction): Promise<void>;
}

export const IMarketingTouchService = createServiceDescriptor<IMarketingTouchService>(
  ServiceChannels.MarketingTouch,
);
