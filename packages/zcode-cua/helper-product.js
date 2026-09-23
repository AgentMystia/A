import { CuaHelperError } from "./broker.js";
import { CuaHelperHost } from "./helper-host.js";
import { createCuaHelperInstaller } from "./helper-install-stage.js";
import { resolveExpectedCuaHelperBundleId } from "./helper-install-plan.js";
import { createLaunchServicesLauncher } from "./helper-launch.js";
import {
  injectPermissionBrokerAgentMcpServers,
  isAuthorizedOfficialZCodeCuaPluginServer,
  isOfficialZCodeCuaPluginCandidate,
  isPotentialZCodeCuaAgentMcpServer,
  omitUnbrokeredZCodeCuaAgentMcpServers,
} from "./helper-mcp-server.js";
import { productHelperCandidatePaths } from "./helper-process-evidence.js";

const RECOVERY_WAIT_MS = 10_000;
const recoveryState = new WeakMap();

function recoveryStateFor(host) {
  let state = recoveryState.get(host);
  if (!state) {
    state = { generation: 0, pendingGeneration: null };
    recoveryState.set(host, state);
  }
  return state;
}

export function markCuaProductHelperAgentEnvUnavailable(host) {
  const state = recoveryStateFor(host);
  state.generation += 1;
  state.pendingGeneration = state.generation;
  return state.generation;
}

function pendingCuaProductHelperRecoveryGeneration(host) {
  return recoveryState.get(host)?.pendingGeneration ?? null;
}

function commitCuaProductHelperRecoveryGeneration(host, generation) {
  const state = recoveryState.get(host);
  if (!state || state.pendingGeneration !== generation) return false;
  state.pendingGeneration = null;
  return true;
}

export function hasCuaProductHelperAgentEnvUnavailable(host) {
  return pendingCuaProductHelperRecoveryGeneration(host) !== null;
}

export function clearCuaProductHelperAgentEnvUnavailable(host) {
  const state = recoveryState.get(host);
  if (state) state.pendingGeneration = null;
}

export function restartCuaHelperPreservingTransport(host, publishUnavailable) {
  let published = false;
  const beforeFreshStart = () => {
    if (published) return;
    published = true;
    publishUnavailable();
  };
  const restarted = host.restartAfterCurrentStartPreservingTransport
    ? host.restartAfterCurrentStartPreservingTransport({ beforeFreshStart })
    : (beforeFreshStart(),
      host.restartAfterCurrentStart().then((handle) => ({ handle, reused: false })));
  return restarted.then((result) => {
    if (!result.reused && !published) {
      throw new CuaHelperError(
        "launch_failed",
        "Computer Use Helper fresh permission restart launched before the unavailable generation was published",
      );
    }
    return result;
  });
}

export async function waitForCuaHelperStartup(startup, deadlineMs = RECOVERY_WAIT_MS) {
  let timer;
  try {
    return await Promise.race([
      startup,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new CuaHelperError(
              "caller_timeout",
              `ZCode Computer Use is still starting after ${deadlineMs}ms; retry the task shortly`,
            ),
          );
        }, deadlineMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createProductCuaHelperHost(options = {}) {
  const env = options.env ?? process.env;
  const helperInstaller =
    options.helperInstaller === false
      ? undefined
      : (options.helperInstaller ??
        createCuaHelperInstaller({
          logger: options.logger,
          env,
          bundledAppPath: options.bundledHelperAppPath,
        }));
  return new CuaHelperHost({
    launcher: options.launcher ?? createLaunchServicesLauncher(),
    helperAppCandidates: productHelperCandidatePaths(env),
    helperInstaller,
    healthTimeoutMs: options.healthTimeoutMs,
    expectedBundleId: resolveExpectedCuaHelperBundleId(env),
    logger: options.logger,
    env,
    ghostCursorOverlay: true,
    verifyLiveProcessIdentity: options.verifyLiveProcessIdentity,
    ...(options.screenRecordingPreflight
      ? { screenRecordingPreflight: options.screenRecordingPreflight }
      : {}),
    pipMode: true,
  });
}

export function createCuaProductMcpServerResolver(host, options = {}) {
  let startInFlight = null;
  let restartInFlight = null;
  let permissionRestartInFlight = null;
  let reconcileInFlight = null;
  let grantSerial = 0;
  let grantChain = Promise.resolve();
  const grants = new Map();
  const seenGrants = new Set();

  function startHelper() {
    if (permissionRestartInFlight) return permissionRestartInFlight.then((result) => result.handle);
    if (startInFlight) return startInFlight;
    const pending = host.start().finally(() => {
      if (startInFlight === pending) startInFlight = null;
    });
    startInFlight = pending;
    return pending;
  }

  function restartHelper() {
    if (restartInFlight) return restartInFlight;
    const previous = permissionRestartInFlight;
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      return (
        await restartCuaHelperPreservingTransport(host, () =>
          markCuaProductHelperAgentEnvUnavailable(host),
        )
      ).handle;
    })().finally(() => {
      if (restartInFlight === pending) restartInFlight = null;
    });
    restartInFlight = pending;
    return pending;
  }

  function restartHelperAfterPermissionGrant() {
    if (permissionRestartInFlight) return permissionRestartInFlight;
    const previous = restartInFlight;
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      return restartCuaHelperPreservingTransport(host, () =>
        markCuaProductHelperAgentEnvUnavailable(host),
      );
    })().finally(() => {
      if (permissionRestartInFlight === pending) permissionRestartInFlight = null;
    });
    permissionRestartInFlight = pending;
    return pending;
  }

  function currentLifecyclePromise() {
    return permissionRestartInFlight
      ? permissionRestartInFlight.then((result) => result.handle)
      : (restartInFlight ?? startInFlight);
  }

  function readLiveHelperTuple() {
    if (!host.running || !host.socketPath || !host.pluginAuthority) return null;
    return { socketPath: host.socketPath, pluginAuthority: host.pluginAuthority };
  }

  function helperTupleChanged(previous) {
    const live = readLiveHelperTuple();
    return (
      live !== null &&
      (live.socketPath !== previous.socketPath || live.pluginAuthority !== previous.pluginAuthority)
    );
  }

  async function reconcileSpawnAdmissionIfNeeded() {
    for (;;) {
      if (!reconcileInFlight) {
        if (!hasCuaProductHelperAgentEnvUnavailable(host)) return;
        reconcileInFlight = (async () => {
          for (;;) {
            const current = currentLifecyclePromise();
            if (current) {
              await waitForCuaHelperStartup(current);
              continue;
            }
            const generation = pendingCuaProductHelperRecoveryGeneration(host);
            if (generation === null) return;
            if (readLiveHelperTuple()) commitCuaProductHelperRecoveryGeneration(host, generation);
            return;
          }
        })().finally(() => {
          reconcileInFlight = null;
        });
      }
      await reconcileInFlight;
      if (!hasCuaProductHelperAgentEnvUnavailable(host)) return;
    }
  }

  async function recoverHelper() {
    await restartHelper();
    await reconcileSpawnAdmissionIfNeeded();
  }

  async function recoverAfterPermissionGrant() {
    await restartHelperAfterPermissionGrant();
    await reconcileSpawnAdmissionIfNeeded();
  }

  function restartAfterPermissionGrant(onboardingSessionId) {
    const id = onboardingSessionId?.trim() || `anonymous-grant-${++grantSerial}`;
    if (seenGrants.has(id)) return Promise.resolve();
    const existing = grants.get(id);
    if (existing) return existing;
    const previous = grantChain;
    const pending = (async () => {
      await previous.catch(() => {});
      await recoverAfterPermissionGrant();
      seenGrants.add(id);
      if (seenGrants.size > 64) {
        const oldest = seenGrants.values().next().value;
        if (oldest) seenGrants.delete(oldest);
      }
    })().finally(() => {
      if (grants.get(id) === pending) grants.delete(id);
    });
    grants.set(id, pending);
    grantChain = pending.catch(() => {});
    return pending;
  }

  async function stabilizeHelperTuple() {
    for (;;) {
      const current = currentLifecyclePromise();
      if (current) {
        try {
          await waitForCuaHelperStartup(current);
        } catch (error) {
          if (!hasCuaProductHelperAgentEnvUnavailable(host))
            markCuaProductHelperAgentEnvUnavailable(host);
          throw error;
        }
        continue;
      }
      await reconcileSpawnAdmissionIfNeeded();
      if (currentLifecyclePromise() || hasCuaProductHelperAgentEnvUnavailable(host)) continue;
      const live = readLiveHelperTuple();
      if (live) return live;
      markCuaProductHelperAgentEnvUnavailable(host);
      throw new CuaHelperError(
        "launch_failed",
        "ZCode Computer Use lifecycle completed without a live broker credential tuple",
      );
    }
  }

  async function ensureHelperReady() {
    const live = readLiveHelperTuple();
    if (!currentLifecyclePromise() && live) {
      try {
        await host.checkHealth(1_000);
      } catch {
        if (options.hasActiveTurn?.()) {
          throw new CuaHelperError(
            "restart_deferred_active_turn",
            "cua helper is unhealthy but an agent turn is active; deferring restart to the next request boundary",
          );
        }
        if (!currentLifecyclePromise() && !helperTupleChanged(live)) restartHelper();
      }
    } else if (!currentLifecyclePromise() && !live) {
      startHelper();
    }
    return stabilizeHelperTuple();
  }

  function warmHelperForBuiltInPlugin() {
    if (host.running || currentLifecyclePromise()) return;
    startHelper().catch(() => {});
  }

  async function resolveMcpServersImpl(servers) {
    const cuaServers = servers?.filter(isPotentialZCodeCuaAgentMcpServer);
    if (!servers || !cuaServers?.length) {
      if (!host.running) {
        warmHelperForBuiltInPlugin();
        return servers;
      }
      try {
        await ensureHelperReady();
      } catch {
        // 没有 CUA server 时，准备失败不改调用方列表。
      }
      return servers;
    }
    const authority = host.pluginAuthority ?? undefined;
    if (
      !cuaServers.some(
        (server) =>
          isOfficialZCodeCuaPluginCandidate(server) &&
          isAuthorizedOfficialZCodeCuaPluginServer(server, authority),
      )
    ) {
      return servers.filter((server) => !isPotentialZCodeCuaAgentMcpServer(server));
    }
    let live;
    try {
      live = await ensureHelperReady();
    } catch {
      if (!hasCuaProductHelperAgentEnvUnavailable(host))
        markCuaProductHelperAgentEnvUnavailable(host);
      return servers.filter((server) => !isPotentialZCodeCuaAgentMcpServer(server));
    }
    const kept = servers.filter(
      (server) =>
        !isPotentialZCodeCuaAgentMcpServer(server) ||
        isAuthorizedOfficialZCodeCuaPluginServer(server, live.pluginAuthority),
    );
    return injectPermissionBrokerAgentMcpServers(kept, live);
  }

  return {
    async resolveMcpServers(servers) {
      return omitUnbrokeredZCodeCuaAgentMcpServers(await resolveMcpServersImpl(servers));
    },
    async restart() {
      await recoverHelper();
    },
    async restartAfterPermissionGrant(onboardingSessionId) {
      await restartAfterPermissionGrant(onboardingSessionId);
    },
    async reconcileRecoveredHelper() {
      if (
        currentLifecyclePromise() ||
        !(hasCuaProductHelperAgentEnvUnavailable(host) && readLiveHelperTuple())
      ) {
        return;
      }
      await reconcileSpawnAdmissionIfNeeded();
    },
  };
}
