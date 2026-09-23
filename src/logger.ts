// 统一日志输出：为 daemon 日志的每一行加上本地时间戳，便于 `eb logs` 排查问题。
// 仅用于写入 data/logs/*.log 的运行日志；CLI 交互输出（eb info/status 等）不加时间戳。

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 本地时间戳，格式：2026-08-31 14:22:05 */
export function timestamp(d = new Date()): string {
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** 逐行加 `[时间] [tag] ` 前缀，多行消息（如 traceback）每行独立成条 */
function format(tag: string, msg: string): string {
  return msg
    .split("\n")
    .map((line) => (line.trim() ? `[${timestamp()}] [${tag}] ${line}` : line))
    .join("\n");
}

export function log(tag: string, msg: string): void {
  console.log(format(tag, msg));
}

export function warn(tag: string, msg: string): void {
  console.warn(format(tag, msg));
}

export function error(tag: string, msg: string): void {
  console.error(format(tag, msg));
}