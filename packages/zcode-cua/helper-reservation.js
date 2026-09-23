import { createServer } from "node:net";
import { chmod, lstat, mkdir, rename, stat, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

import { isWindowsNamedPipePath } from "./helper-broker-runtime.js";

const RESERVATION_SUFFIX = ".host-reservation";
const PENDING_SUFFIX = ".pending";
const SOCKET_PATH_BUDGET = 100;
const SILENT_LOGGER = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

function currentProcessUid() {
  const getuid = process.getuid;
  return typeof getuid === "function" ? getuid.call(process) : null;
}

function assertCurrentUserOwner(path, uid) {
  const current = currentProcessUid();
  if (current !== null && uid !== current) {
    throw new Error(`refusing to use broker path not owned by current user: ${path}`);
  }
}

async function ensureSocketDirectory(socketPath) {
  const directory = dirname(socketPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await stat(directory);
  assertCurrentUserOwner(directory, info.uid);
  if ((info.mode & 0o777) !== 0o700) await chmod(directory, 0o700);
}

async function unlinkIfOwnedSocket(socketPath) {
  let info;
  try {
    info = await lstat(socketPath);
  } catch {
    return;
  }
  if (!info.isSocket()) return;
  const uid = currentProcessUid();
  if (uid !== null && info.uid !== uid) return;
  await unlink(socketPath).catch(() => {});
}

function listenOn(server, socketPath) {
  return new Promise((resolveListen, rejectListen) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolveListen();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

function closeServer(server) {
  return new Promise((resolveClose) => {
    server.close(() => resolveClose());
  });
}

export async function createTransportReservation(options) {
  const { socketPath } = options;
  const logger = options.logger ?? SILENT_LOGGER;
  if (isWindowsNamedPipePath(socketPath)) return null;
  const reservationPath = `${socketPath}${RESERVATION_SUFFIX}`;
  const pendingSocketPath = `${socketPath}${PENDING_SUFFIX}`;
  if (reservationPath.length > SOCKET_PATH_BUDGET) {
    logger.warn(
      undefined,
      `cua transport rendezvous disabled: socket path budget exceeded (${reservationPath.length} > ${SOCKET_PATH_BUDGET})`,
    );
    return null;
  }
  let server = null;
  try {
    await ensureSocketDirectory(socketPath);
    await unlinkIfOwnedSocket(reservationPath);
    server = createServer((socket) => {
      socket.destroy();
    });
    server.on("error", (error) => {
      logger.warn(
        undefined,
        `cua transport reservation listener error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    await listenOn(server, reservationPath);
    await chmod(reservationPath, 0o600);
    await rename(reservationPath, socketPath);
  } catch (error) {
    if (server) await closeServer(server).catch(() => {});
    await unlinkIfOwnedSocket(reservationPath);
    logger.warn(
      undefined,
      `cua transport rendezvous disabled: reservation failed (${error instanceof Error ? error.message : String(error)})`,
    );
    return null;
  }
  const listener = server;
  let state = "reserved";
  let tail = null;
  const single = (run) => {
    const pending = (tail ?? Promise.resolve()).then(run, run);
    tail = pending.catch(() => {});
    return pending;
  };
  return {
    pendingSocketPath,
    get holdsPublishedPath() {
      return state === "reserved";
    },
    publish() {
      return single(async () => {
        if (state === "reserved") {
          await rename(pendingSocketPath, socketPath);
          state = "published";
          await closeServer(listener);
        }
      });
    },
    release() {
      return single(async () => {
        if (state === "reserved") {
          state = "released";
          await closeServer(listener);
          await unlinkIfOwnedSocket(socketPath);
        }
      });
    },
    unlinkPublishedIfOwned() {
      return single(async () => {
        if (state === "published") await unlinkIfOwnedSocket(socketPath);
      });
    },
  };
}
