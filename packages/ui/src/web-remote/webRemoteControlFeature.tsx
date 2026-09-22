import { createContext, useContext, type ReactNode } from "react";

const WebRemoteControlFeatureContext = createContext(true);

/** 发布包上下文默认值是 true。调用方省略开关时入口保持可用。 */
export function WebRemoteControlFeatureProvider({
  enabled = true,
  children,
}: {
  enabled?: boolean;
  children: ReactNode;
}) {
  return (
    <WebRemoteControlFeatureContext.Provider value={enabled}>
      {children}
    </WebRemoteControlFeatureContext.Provider>
  );
}

export function useWebRemoteControlFeatureEnabled(): boolean {
  return useContext(WebRemoteControlFeatureContext);
}
