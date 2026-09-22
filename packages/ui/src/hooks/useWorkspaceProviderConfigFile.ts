import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ZCodeProvider } from "@zcode/shared";
import {
  useBaseWorkspaceServices,
  useWorkspaceServicesResolution,
} from "@/hooks/useWorkspaceServices.js";
import { logger } from "@/logger.js";
import {
  isProviderConfigQueryReady,
  resolveProviderConfigLogScope,
  selectProviderConfigTaskService,
  type ProviderConfigServiceScope,
} from "@/lib/providerConfigFileQuery.js";

export interface WorkspaceProviderConfigFileState {
  path: string | null;
  exists: boolean;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: WorkspaceProviderConfigFileState = {
  path: null,
  exists: false,
  loading: true,
  error: null,
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || String(error);
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return String(error);
}

export function useWorkspaceProviderConfigFile(
  workspacePath: string,
  provider: ZCodeProvider,
  remoteSessionId: string | undefined,
  workspaceIdentity: string | undefined,
  options: { serviceScope?: ProviderConfigServiceScope; enabled?: boolean } = {},
) {
  const configuredServiceScope = options.serviceScope ?? "workspace";
  const enabled = options.enabled ?? true;
  const resolution = useWorkspaceServicesResolution(
    workspacePath,
    remoteSessionId,
    workspaceIdentity,
  );
  const baseServices = useBaseWorkspaceServices();
  const workspaceService = resolution.services.zcodeTaskService ?? null;
  const baseService = baseServices.zcodeTaskService ?? null;
  const resolvedRemoteSessionId = resolution.remoteSessionId;
  const taskService = selectProviderConfigTaskService({
    configuredServiceScope,
    workspaceZCodeService: workspaceService,
    baseZCodeService: baseService,
    remoteSessionId: resolvedRemoteSessionId,
  });
  const scope = resolveProviderConfigLogScope({
    configuredServiceScope,
    remoteSessionId: resolvedRemoteSessionId,
    workspaceZCodeService: workspaceService,
    baseZCodeService: baseService,
  });
  const ready = isProviderConfigQueryReady({
    workspaceIdentity,
    remoteSessionId: resolvedRemoteSessionId,
  });
  const [state, setState] = useState<WorkspaceProviderConfigFileState>(INITIAL_STATE);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestVersionRef = useRef(0);
  const refresh = useCallback(() => {
    setRefreshVersion((current) => current + 1);
  }, []);

  useEffect(() => {
    let disposed = false;
    if (!workspacePath || !enabled || !ready) {
      requestVersionRef.current += 1;
      setState({ path: null, exists: false, loading: false, error: null });
      return () => {
        disposed = true;
      };
    }
    if (!taskService) {
      requestVersionRef.current += 1;
      setState({ path: null, exists: false, loading: true, error: null });
      return () => {
        disposed = true;
      };
    }

    const requestVersion = requestVersionRef.current + 1;
    requestVersionRef.current = requestVersion;
    setState({ path: null, exists: false, loading: true, error: null });
    const sessionLabel = resolvedRemoteSessionId ?? "none";
    logger.info(
      `[useWorkspaceProviderConfigFile] 开始读取 provider 配置路径 workspace=${workspacePath} provider=${provider} scope=${scope} session=${sessionLabel}`,
    );
    void taskService
      .getWorkspaceProviderConfigFile({
        workspacePath,
        provider,
        ...(workspaceIdentity ? { workspaceIdentity } : {}),
      })
      .then((result) => {
        if (disposed || requestVersionRef.current !== requestVersion) {
          return;
        }
        logger.info(
          `[useWorkspaceProviderConfigFile] 读取 provider 配置路径成功 workspace=${workspacePath} provider=${provider} scope=${scope} session=${sessionLabel} exists=${result.exists} path=${result.path}`,
        );
        setState({
          path: result.path,
          exists: result.exists,
          loading: false,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (disposed || requestVersionRef.current !== requestVersion) {
          return;
        }
        const message = getErrorMessage(error);
        logger.warn("[useWorkspaceProviderConfigFile] 读取 provider 配置路径失败", {
          workspacePath,
          provider,
          scope,
          remoteSessionId: resolvedRemoteSessionId,
          error: message,
        });
        setState({ path: null, exists: false, loading: false, error: message });
      });

    return () => {
      disposed = true;
    };
  }, [
    enabled,
    provider,
    ready,
    refreshVersion,
    resolvedRemoteSessionId,
    scope,
    taskService,
    workspaceIdentity,
    workspacePath,
  ]);

  return useMemo(() => ({ ...state, refresh }), [refresh, state]);
}
