// Python sidecar 桥接层：
// - 以子进程方式启动 python/sidecar.py（AstrBot 插件宿主）
// - 通过 stdin/stdout 上的 JSON Lines 协议通信
// - sidecar 崩溃时自动重启
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { BridgeChatResult } from "../types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SIDECAR_PATH = resolve(__dirname, "../../python/sidecar.py");

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
}

export interface PluginInfo {
  name: string;
  author: string;
  desc: string;
  version: string;
  handlers: string[];
}

export class SidecarBridge extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private readyPromise: Promise<PluginInfo[]> | null = null;
  private restarting = false;

  private pythonPath: string;
  private pluginsDir: string;
  private timeoutMs: number;

  constructor(pythonPath: string, pluginsDir: string, timeoutMs: number) {
    super();
    this.pythonPath = pythonPath;
    this.pluginsDir = pluginsDir;
    this.timeoutMs = timeoutMs;
  }

  /** 启动 sidecar 并等待其汇报已加载的插件列表 */
  start(): Promise<PluginInfo[]> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = new Promise((resolveReady, rejectReady) => {
      try {
        this.proc = spawn(this.pythonPath, [SIDECAR_PATH, this.pluginsDir], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (err) {
        rejectReady(err as Error);
        return;
      }
      const proc = this.proc as ChildProcessWithoutNullStreams;

      let buffer = "";
      proc.stdout.setEncoding("utf-8");
      proc.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line) this.handleLine(line);
        }
      });

      proc.stderr.setEncoding("utf-8");
      proc.stderr.on("data", (chunk: string) => {
        // Python 侧未捕获输出（traceback 等），原样打到日志
        for (const l of chunk.split("\n")) {
          if (l.trim()) console.error(`[sidecar:py] ${l}`);
        }
      });

      proc.on("error", (err) => {
        console.error(`[sidecar] 启动失败: ${err.message}`);
        rejectReady(err);
      });

      proc.on("exit", (code, signal) => {
        this.handleExit(code, signal, resolveReady);
      });

      // 首次 ready 消息在 handleLine 中 resolve
      this.once("ready", (plugins: PluginInfo[]) => resolveReady(plugins));
      this.once("ready-error", (err: Error) => rejectReady(err));
    });
    return this.readyPromise;
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error(`[sidecar] 无法解析的输出: ${line.slice(0, 200)}`);
      return;
    }

    switch (msg.type) {
      case "ready":
        console.log(
          `[sidecar] 插件加载完成: ${
            msg.plugins?.map((p: PluginInfo) => p.name).join(", ") || "(无)"
          }`
        );
        this.emit("ready", msg.plugins ?? []);
        break;
      case "log":
        console.log(`[astrbot:${msg.level ?? "info"}] ${msg.msg}`);
        break;
      case "response": {
        const p = this.pending.get(msg.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.id);
          if (msg.ok) p.resolve(msg.result);
          else p.reject(new Error(msg.error ?? "unknown sidecar error"));
        }
        break;
      }
      default:
        console.log(`[sidecar] ${line.slice(0, 200)}`);
    }
  }

  private handleExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    rejectReady: (e: Error) => void
  ): void {
    const crashed = !this.readyPromiseSettled();
    if (crashed) {
      rejectReady(new Error(`sidecar 进程提前退出 (code=${code} signal=${signal})`));
    }
    // 拒绝所有未完成请求
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("sidecar 进程已退出"));
      this.pending.delete(id);
    }
    console.error(`[sidecar] 进程退出 (code=${code} signal=${signal})，3 秒后重启`);
    if (!this.restarting) {
      this.restarting = true;
      setTimeout(() => {
        this.restarting = false;
        this.readyPromise = null;
        this.start().catch((e) =>
          console.error(`[sidecar] 重启失败: ${e.message}`)
        );
      }, 3000);
    }
  }

  private readyPromiseSettled(): boolean {
    // readyPromise 只在成功 ready 或启动失败后视为落定
    return this.listenerCount("ready") === 0;
  }

  private send(obj: Record<string, unknown>): void {
    if (!this.proc || this.proc.killed) {
      throw new Error("sidecar 未运行");
    }
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }

  private request(
    type: string,
    payload: Record<string, unknown>
  ): Promise<BridgeChatResult> {
    return new Promise((resolve, reject) => {
      const id = `req-${++this.seq}`;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`sidecar 请求超时 (${this.timeoutMs}ms)`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, type, ...payload });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  /**
   * 把一条用户消息交给插件宿主处理。
   * matched=true 表示命中了某个 AstrBot 插件指令，reply 为其回复。
   */
  chat(text: string, sender: { id: string; name: string }): Promise<BridgeChatResult> {
    return this.request("chat", { text, sender });
  }

  stop(): void {
    this.proc?.kill();
    this.proc = null;
  }
}
