import { execFile } from "node:child_process";

// 发布包把这份 execFileText 单独放在只 import execFile 的模块。
// stderr 用空格拼接。helper-install-verify.js 里的同名函数用换行，不是这一份。
export function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function execFileText(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${command} ${args.join(" ")} failed: ${formatErrorMessage(error)}${stderr ? ` ${stderr}` : ""}`;
        reject(new Error(detail));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
