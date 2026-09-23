import { createHash, createHmac, randomBytes } from "node:crypto";
import type { ICredentialService } from "@zcode/services";
import type { AppSettings } from "@zcode/shared";

export const WEB_REMOTE_CONTROL_PASS_HASH_KEY = "web-remote-control:external-relay:pass_hash";

export interface WebRemoteControlRelayAuth {
  deviceSid: string;
  passHash: string;
}

export interface WebRemoteControlRelayAuthProvider {
  createPassword(): string;
  createPassHash(password: string): string;
  calculateProof(passHash: string, nonce: string, role: string, deviceSid: string): string;
}

export function createNodeWebRemoteControlRelayAuthProvider(): WebRemoteControlRelayAuthProvider {
  return {
    createPassword: () => randomBytes(24).toString("base64url"),
    createPassHash: (password) => createHash("sha256").update(password).digest("base64"),
    calculateProof: (passHash, nonce, role, deviceSid) =>
      createHmac("sha256", passHash).update(`${nonce}|${role}|${deviceSid}`).digest("base64url"),
  };
}

export function safeAuthLogFields(auth: { deviceSid?: string; passHash?: string }): {
  hasDeviceSid: boolean;
  deviceSidSuffix?: string;
  hasPassHash: boolean;
} {
  const deviceSid = auth.deviceSid?.trim();
  return {
    hasDeviceSid: !!deviceSid,
    deviceSidSuffix: deviceSid ? deviceSid.slice(-6) : undefined,
    hasPassHash: !!auth.passHash?.trim(),
  };
}

export interface WebRemoteControlRelayAuthStorage {
  load(): Promise<WebRemoteControlRelayAuth | undefined>;
  save(auth: WebRemoteControlRelayAuth): Promise<void>;
  clear(): Promise<void>;
  rotate(auth: WebRemoteControlRelayAuth): Promise<void>;
}

export function createWebRemoteControlRelayAuthStorageProvider(input: {
  credentialService: ICredentialService;
  loadSettings: () => Promise<AppSettings>;
  patchSettings: (patch: Partial<AppSettings>) => Promise<void>;
  logger?: { info: (...args: unknown[]) => void; warn: (...args: unknown[]) => void };
}): WebRemoteControlRelayAuthStorage {
  const clear = async () => {
    await input.patchSettings({ webRemoteControlExternalRelayDevice: undefined });
    await input.credentialService.delete(WEB_REMOTE_CONTROL_PASS_HASH_KEY);
    input.logger?.info("[web-remote-control] external relay auth cleared", {
      hasDeviceSid: false,
      hasPassHash: false,
    });
  };
  return {
    async load() {
      const deviceSid = (
        await input.loadSettings()
      ).webRemoteControlExternalRelayDevice?.deviceSid.trim();
      const passHash = (
        await input.credentialService.load(WEB_REMOTE_CONTROL_PASS_HASH_KEY)
      )?.trim();
      if (!deviceSid && !passHash) return undefined;
      if (!deviceSid || !passHash) {
        input.logger?.warn("[web-remote-control] external relay auth partial state cleared", {
          hasDeviceSid: !!deviceSid,
          hasPassHash: !!passHash,
        });
        await clear();
        return undefined;
      }
      input.logger?.info("[web-remote-control] external relay auth loaded", {
        ...safeAuthLogFields({ deviceSid, passHash }),
      });
      return { deviceSid, passHash };
    },
    async save(auth) {
      await input.patchSettings({
        webRemoteControlExternalRelayDevice: { deviceSid: auth.deviceSid },
      });
      await input.credentialService.save(WEB_REMOTE_CONTROL_PASS_HASH_KEY, auth.passHash);
      input.logger?.info("[web-remote-control] external relay auth saved", {
        ...safeAuthLogFields(auth),
      });
    },
    clear,
    async rotate(auth) {
      await clear();
      await this.save(auth);
      input.logger?.info("[web-remote-control] external relay auth rotated", {
        ...safeAuthLogFields(auth),
      });
    },
  };
}

export interface WebRemoteControlFeatureGate {
  isEnabled(): boolean;
  assertEnabled(): void;
}

export function createWebRemoteControlFeatureGate(enabled = true): WebRemoteControlFeatureGate {
  return {
    isEnabled: () => enabled,
    assertEnabled: () => {
      if (!enabled) throw new Error("Web remote control is disabled in this build");
    },
  };
}

export async function resetExternalRelayDeviceAuth(
  storage: WebRemoteControlRelayAuthStorage,
  logger: { info: (...args: unknown[]) => void },
  reason: string,
): Promise<void> {
  await storage.clear();
  logger.info("[web-remote-control] external relay auth reset", { reason });
}
