import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";

const HELPER_LOG_KEEP = 7;
const HELPER_LOG_NAME = /^zcode-cua-helper-\d{4}-\d{2}-\d{2}\.jsonl$/u;

export function helperLogLines(text) {
  const timestamp = new Date().toISOString();
  let output = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let record;
    let parsed = null;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const { scope, level, event, evidence, ...rest } = parsed;
      record = {
        timestamp,
        level: typeof level === "string" ? level : "info",
        event: typeof event === "string" ? event : "helper runtime event",
        module: typeof scope === "string" ? scope : "zcode-cua-helper",
        pid: process.pid,
        ...(evidence === undefined ? {} : { context: evidence }),
        ...rest,
      };
    } else {
      const matched = /^\[([a-z0-9-]+)\]/iu.exec(trimmed);
      record = {
        timestamp,
        level: "info",
        event: matched ? matched[1] : "helper stderr",
        module: "zcode-cua-helper",
        pid: process.pid,
        message: matched ? trimmed.slice(matched[0].length).trim() : trimmed,
      };
    }
    output += `${JSON.stringify(record)}
`;
  }
  return output;
}

export function pruneHelperLogs(directory) {
  try {
    const stale = readdirSync(directory)
      .filter((name) => HELPER_LOG_NAME.test(name))
      .sort()
      .reverse()
      .slice(HELPER_LOG_KEEP);
    for (const name of stale) {
      try {
        unlinkSync(join(directory, name));
      } catch {
        // 单个旧日志删不掉时继续清其余文件。
      }
    }
  } catch {
    // 日志目录还不存在时不阻断启动。
  }
}

// 发布包在加载 broker 时安装这段。没有 --exit-log 就立刻返回，main/host/scheduler 都带这份代码。
const exitLogFlag = process.argv.indexOf("--exit-log");
const exitLogPath =
  exitLogFlag >= 0 && exitLogFlag + 1 < process.argv.length ? process.argv[exitLogFlag + 1] : null;
if (exitLogPath) {
  try {
    mkdirSync(dirname(exitLogPath), { recursive: true });
  } catch {
    // 目录创建失败时仍尝试挂上 stderr 镜像。
  }
  pruneHelperLogs(dirname(exitLogPath));
  const writeStderr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk, ...rest) => {
    try {
      const text = typeof chunk === "string" ? chunk : String(chunk);
      appendFileSync(exitLogPath, helperLogLines(text));
    } catch {
      // 日志写失败不能挡住原来的 stderr。
    }
    return writeStderr(chunk, ...rest);
  };
}
