import { useEffect } from "react";
import type { SettingsSectionId } from "@/lib/settingsNavigation.js";
import { useStore } from "zustand";

import {
  acknowledgeMarketingNavigation,
  MARKETING_SETTINGS_SECTION,
  marketingNavigationStore,
} from "./marketingNavigation.js";

export function useMarketingSettingsNavigationAck(input: {
  activeSection: SettingsSectionId;
  sectionIds: readonly SettingsSectionId[];
}) {
  const request = useStore(marketingNavigationStore, (state) => state.request);
  const { activeSection, sectionIds } = input;
  useEffect(() => {
    if (request?.target.page !== "settings") return;
    const section = request.target.section
      ? MARKETING_SETTINGS_SECTION[request.target.section]
      : activeSection;
    if (!sectionIds.includes(section)) {
      acknowledgeMarketingNavigation(request.id, new Error("marketing_navigation_unavailable"));
      return;
    }
    if (activeSection === section && !request.target.provider_id) {
      acknowledgeMarketingNavigation(request.id);
    }
  }, [activeSection, request, sectionIds]);
}
