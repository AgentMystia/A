import { createAcknowledgedWebRemoteControlRelayProtocol } from "./webRemoteControl/acknowledgedRelayProtocol.js";

export {
  connectRemote,
  createRemoteBackend,
  deployServer,
  DockerBackend,
  isDockerAvailable,
  isWSLAvailable,
  listDockerContainers,
  listWSLDistros,
  parseDockerContainerList,
  parseWSLDistroList,
  performHandshake,
  pickRemoteRuntimeEnv,
  wrapStdioStream,
  WSLBackend,
} from "@zcode/server/remote";

// 动态入口必须引用 relay 工厂，esbuild 才会把它和 index 分到同一组模块。
// 引用本身没有运行时效果，产物里不会留下调用。
void createAcknowledgedWebRemoteControlRelayProtocol;
