import { execFile } from "node:child_process";

// 发布包只有这一份 execFileText。它单独 import execFile，失败时用换行拼接 stderr。
// 安装校验、解压和活进程身份都调用这里，不能再在校验模块里复制一份。
export function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${command} ${args.join(" ")} failed: ${formatErrorMessage(error)}${stderr ? `\n${stderr}` : ""}`;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
