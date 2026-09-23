import { CuaHelperError } from "./broker.js";
import { isCuaLocalDevelopmentRuntime } from "./helper-install-plan.js";
import { defaultCuaHelperVerifierDependencies } from "./helper-install-verify.js";
import { createCuaHelperInstaller } from "./helper-install-stage.js";
import { buildHelperOpenArgs } from "./helper-launch.js";
import { isPotentialZCodeCuaAgentMcpServer } from "./helper-mcp-server.js";
import {
  clearCuaProductHelperAgentEnvUnavailable,
  createCuaProductMcpServerResolver,
  createProductCuaHelperHost,
  hasCuaProductHelperAgentEnvUnavailable,
  markCuaProductHelperAgentEnvUnavailable,
  waitForCuaHelperStartup,
} from "./helper-product.js";
import {
  cuaBrokerRefreshMarkerPath,
  publishCuaBrokerRefreshMarker,
} from "./helper-refresh-marker.js";
import { reapOrphanedHelpers } from "./helper-reap.js";
import { isScreenCaptureProbeSuccess } from "./helper-screen-probe.js";

export {
  isCuaLocalDevelopmentRuntime,
  defaultCuaHelperVerifierDependencies,
  createCuaHelperInstaller,
  buildHelperOpenArgs,
  cuaBrokerRefreshMarkerPath,
  publishCuaBrokerRefreshMarker,
  createProductCuaHelperHost,
  createCuaProductMcpServerResolver,
  waitForCuaHelperStartup,
  isPotentialZCodeCuaAgentMcpServer,
  markCuaProductHelperAgentEnvUnavailable,
  hasCuaProductHelperAgentEnvUnavailable,
  clearCuaProductHelperAgentEnvUnavailable,
  reapOrphanedHelpers,
  isScreenCaptureProbeSuccess,
};

export const HELPER_ADDON_ENV = "ZCODE_CUA_HELPER_ADDON";
export const WINDOWS_DEV_CONTROL_PROTOCOL = "zcode-cua-windows-dev/v1";

const UNAVAILABLE = "Computer Use is not available in this build.";

export async function resolveHelperPermissionSubjectIdentity(_appPath) {
  throw new CuaHelperError("helper_unavailable", UNAVAILABLE);
}

export function loadRealNativeAddon(_options) {
  throw new CuaHelperError("helper_unavailable", UNAVAILABLE);
}

export function resolvePackagedNativeAddonPath(_options) {
  return undefined;
}

export function resolveInTreeAddonPath(_options) {
  return undefined;
}

export function createAxReadOnlyMethods(_source, _registry, _options) {
  return {};
}

export const ROLE_TO_KIND = {};

export function roleToKind(_role) {
  return undefined;
}

export class CuaHelperLifecycleManager {
  #dispose;
  #current;
  #disposed = false;
  constructor(dispose) {
    this.#dispose = dispose;
    this.#current = undefined;
  }
  async acquire(options) {
    if (typeof options?.isAdmitted === "function" && !options.isAdmitted()) {
      return undefined;
    }
    const managed = options?.create?.();
    this.#current = managed;
    return managed;
  }
  peek() {
    return this.#current;
  }
  get disposed() {
    return this.#disposed;
  }
  async dispose(managed) {
    this.#disposed = true;
    await this.#dispose?.(managed ?? this.#current);
  }
}

export class CuaProductHelperWorkspaceRegistry {
  setEnabled(_context, _enabled) {}
}

export function isOfficialCuaPluginEnabledForWorkspace(_options) {
  return false;
}

export async function requestHelperAccessibilityPermissionViaLaunchServices(_options) {
  return { ok: false, reason: UNAVAILABLE };
}

export async function requestHelperScreenRecordingPermissionViaLaunchServices(_options) {
  return { ok: false, reason: UNAVAILABLE };
}
