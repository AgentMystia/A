import type {
  RemoteAssetInstallMode,
  RemoteConnectionWizardKind,
  RemoteTarget,
} from "@zcode/shared";
import { isValidWslUser, normalizeRemoteResourcePackageSelection } from "@zcode/shared";
import type { SSHAuthMethod } from "@/hooks/useRemoteConnectionForm.js";
import type { RemoteWizardStep } from "@/RemoteConnectionWizardChrome.js";

type WizardIntlLike = {
  formatMessage: (descriptor: { id: string }, values?: Record<string, string>) => string;
};

interface RemoteConnectionFormSnapshot {
  kind: RemoteConnectionWizardKind;
  host: string;
  port: string;
  username: string;
  sshAuthMethod: SSHAuthMethod;
  assetInstallMode?: RemoteAssetInstallMode;
  selectedSshConfigAlias?: string | null;
  password: string;
  privateKeyPath: string;
  privateKeyPassphrase: string;
  wslDistro: string;
  wslUser?: string;
  dockerContainer: string;
  manualDockerContainer?: string;
  serverUrl?: string;
  serverName?: string;
  serverToken?: string;
  serverWorkspacePath?: string;
}

export function listRemoteConnectionWizardKinds(options: {
  isWindowsDesktop: boolean;
  isLocalDevelopmentRuntime: boolean;
}): RemoteConnectionWizardKind[] {
  const kinds: RemoteConnectionWizardKind[] = ["ssh"];
  // 发布包只在本地开发运行形态把 server 放进入口。打包后的桌面端该标志为 false，
  // 选择页不出现 server，但表单分支仍保留，styles 才会带上 server.* 文案。
  if (options.isLocalDevelopmentRuntime) {
    kinds.push("server");
  }
  // 远程连接入口里 WSL 和 SSH 同属主机类连接。
  // Windows 下先放 WSL 再放 Docker，避免 WSL 被 Docker 隔开后在选择页显得离 SSH 很远。
  // 本地开发时 server 插在 SSH 和 WSL 之间，顺序与发布包一致。
  if (options.isWindowsDesktop) {
    kinds.push("wsl");
  }
  // Docker入口之前完全依赖预探测结果决定是否展示。
  // 当探测能力暂时不可用、或用户还没切到 Docker 时，入口会直接消失，
  // 用户甚至不知道这里支持 Docker 连接。改为始终展示入口，切换后再懒加载探测结果。
  kinds.push("docker");
  return kinds;
}

export function getRemoteWizardStepCopy(
  intl: WizardIntlLike,
  step: RemoteWizardStep,
  kind: RemoteConnectionWizardKind,
) {
  switch (step) {
    case "kind":
      return {
        title: intl.formatMessage({ id: "remote.kindStepTitle" }),
        description: intl.formatMessage({ id: "remote.kindStepDescription" }),
      };
    case "settings":
      return {
        title: intl.formatMessage({ id: "remote.settingsStepTitle" }),
        description: intl.formatMessage(
          { id: "remote.settingsStepDescription" },
          {
            method: intl.formatMessage({ id: `remote.kind.${kind}` }),
          },
        ),
      };
    case "connecting":
      return {
        title: intl.formatMessage({ id: "remote.connectingStepTitle" }),
        description: intl.formatMessage(
          { id: "remote.connectingStepDescription" },
          {
            method: intl.formatMessage({ id: `remote.kind.${kind}` }),
          },
        ),
      };
    case "directory":
      return {
        title: intl.formatMessage({ id: "remote.selectDirectoryTitle" }),
        description: intl.formatMessage({ id: "remote.selectDirectoryDescription" }),
      };
  }
}

export function buildRemoteTarget(
  intl: WizardIntlLike,
  snapshot: RemoteConnectionFormSnapshot,
): { target?: RemoteTarget; errorMessage?: string } {
  switch (snapshot.kind) {
    case "ssh":
      if (!snapshot.host || !snapshot.username) {
        return {
          errorMessage: intl.formatMessage({ id: "ssh.validation.required" }),
        };
      }

      if (snapshot.sshAuthMethod === "password" && !snapshot.password) {
        return {
          errorMessage: intl.formatMessage({ id: "ssh.validation.passwordRequired" }),
        };
      }

      if (snapshot.sshAuthMethod === "privateKey" && !snapshot.privateKeyPath) {
        return {
          errorMessage: intl.formatMessage({ id: "ssh.validation.privateKeyRequired" }),
        };
      }

      const sshConfigAlias = snapshot.selectedSshConfigAlias?.trim();

      return {
        target: {
          kind: "ssh",
          host: snapshot.host,
          port: snapshot.port ? Number(snapshot.port) : undefined,
          username: snapshot.username,
          ...(sshConfigAlias ? { sshConfigAlias } : {}),
          assetInstallMode: snapshot.assetInstallMode,
          ...(snapshot.sshAuthMethod === "password" && snapshot.password
            ? { password: snapshot.password }
            : {}),
          ...(snapshot.sshAuthMethod === "privateKey" && snapshot.privateKeyPath
            ? { privateKeyPath: snapshot.privateKeyPath }
            : {}),
          ...(snapshot.sshAuthMethod === "privateKey" && snapshot.privateKeyPassphrase
            ? { privateKeyPassphrase: snapshot.privateKeyPassphrase }
            : {}),
        },
      };
    case "docker":
      // Docker 运行中列表可能因为探测失败或刷新延迟不完整。
      // 手动输入必须独立于下拉选择，提交时优先使用手动输入，空值再回落到下拉选择。
      const dockerContainer =
        snapshot.manualDockerContainer?.trim() || snapshot.dockerContainer.trim();

      if (!dockerContainer) {
        return {
          errorMessage: intl.formatMessage({ id: "docker.validation.required" }),
        };
      }

      return {
        target: {
          kind: "docker",
          container: dockerContainer,
        },
      };
    case "wsl": {
      const wslUser = snapshot.wslUser?.trim();
      if (wslUser && !isValidWslUser(wslUser)) {
        return {
          errorMessage: intl.formatMessage({ id: "wsl.validation.invalidUser" }),
        };
      }
      return {
        target: {
          kind: "wsl",
          distro: snapshot.wslDistro || undefined,
          ...(wslUser ? { user: wslUser } : {}),
        },
      };
    }
    case "server": {
      const serverUrl = snapshot.serverUrl?.trim() ?? "";
      if (!serverUrl) {
        return {
          errorMessage: intl.formatMessage({ id: "server.validation.urlRequired" }),
        };
      }
      try {
        new URL(serverUrl);
      } catch {
        return {
          errorMessage: intl.formatMessage({ id: "server.validation.invalidUrl" }),
        };
      }
      const serverName = snapshot.serverName?.trim();
      const serverToken = snapshot.serverToken?.trim();
      const serverWorkspacePath = snapshot.serverWorkspacePath?.trim();
      return {
        target: {
          kind: "server",
          url: serverUrl,
          ...(serverName ? { name: serverName } : {}),
          ...(serverToken ? { token: serverToken } : {}),
          ...(serverWorkspacePath ? { workspacePath: serverWorkspacePath } : {}),
        },
      };
    }
  }
}

export function withDefaultRemoteResourcePackages(target: RemoteTarget): RemoteTarget {
  if (target.kind !== "ssh") {
    return target;
  }

  return {
    ...target,
    resourcePackages: {
      // 当前分支只保留一个 ZCode Agent，SSH 向导再让用户手动挑资源包会产生无意义分叉。
      // 这里统一走默认 active 资源集，历史重连传入的旧选择不再影响部署范围。
      selectedPackageIds: normalizeRemoteResourcePackageSelection(),
    },
  };
}
