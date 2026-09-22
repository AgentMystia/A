import { createContext } from "react";

import type { MarketingTouchController } from "./marketingTouchController.js";

export const MarketingCampaignContext = createContext<MarketingTouchController | null>(null);

export const MarketingCampaignRefreshContext = createContext<(() => void) | null>(null);
