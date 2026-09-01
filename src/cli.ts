// EmberBot CLI —— `eb start` 同步启动 EmberBot 网关 + OpenClaw 网关
//
// 用法:
//   eb start    启动 EmberBot + OpenClaw（写 PID，Ctrl+C 或 eb stop 停止）
//   eb stop     停止 EmberBot + OpenClaw
//   eb restart  重启
//   eb status   查看状态
//   eb gateway  仅启动 EmberBot 网关（不启动 OpenClaw）
//   eb openclaw 仅启动 OpenClaw（不启动 EmberBot）
//
// LLM 服务由用户提供：EmberBot 只对外暴露 OpenAI 兼容接口，真实模型由用户在
// OpenClaw 的模型配置里填入，EmberBot 不关心也不内置具体模型。

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, openSync, closeSync, watchFile, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = join(ROOT, "data");
const LOG_DIR = join(DATA_DIR, "logs");
const PID_FILE = join(DATA_DIR, "pids.json");

interface Pids {
  ember: number | null;
  openclaw: number | null;
}

const emptyPids = (): Pids => ({ ember: null, openclaw: null });

function readPids(): Pids {
  if (!existsSync(PID_FILE)) return emptyPids();
  try {
    return { ...emptyPids(), ...JSON.parse(readFileSync(PID_FILE, "utf-8")) };
  } catch {
    return emptyPids();
  }
}

function writePids(pids: Pids): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));
}

function clearPids(): void {
  if (existsSync(PID_FILE)) rmSync(PID_FILE);
}

function isAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    // signal 0 仅探测进程是否存在
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function killPid(pid: number | null, signal: NodeJS.Signals = "SIGTERM"): void {
  if (!pid || !isAlive(pid)) return;
  try {
    process.kill(pid, signal);
  } catch {
    /* 已退出 */
  }
}

// 把 openclawCmd 字符串拆成 [cmd, ...args]，如 "openclaw gateway"
function parseCmd(cmd: string): { cmd: string; args: string[] } {
  const parts = cmd.trim().split(/\s+/).filter(Boolean);
  return { cmd: parts[0], args: parts.slice(1) };
}

function spawnEmber(): Promise<ChildProcess> {
  return startDaemon("node", ["src/index.ts"], join(LOG_DIR, "ember.log"), ROOT);
}

function startOpenclaw(cmdRaw: string): Promise<ChildProcess> {
  const { cmd, args } = parseCmd(cmdRaw);
  return startDaemon(cmd, args, join(LOG_DIR, "openclaw.log"), ROOT);
}

/**
 * 以 daemon 方式启动子进程：stdout/stderr 追加到日志文件，脱离当前终端。
 * 这样 `eb start` 启动后立即返回控制权，EmberBot/OpenClaw 在后台独立运行。
 */
function startDaemon(
  cmd: string,
  args: string[],
  logFile: string,
  cwd: string
): Promise<ChildProcess> {
  mkdirSync(dirname(logFile), { recursive: true });
  const outFd = openSync(logFile, "a");
  return new Promise((resolveSpawn, rejectSpawn) => {
    const proc = spawn(cmd, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", outFd, outFd],
      detached: true,
    });
    closeSync(outFd); // 子进程已复制该 fd
    proc.once("spawn", () => resolveSpawn(proc));
    proc.once("error", (err) => rejectSpawn(err));
    // 父进程退出后继续保持子进程运行
    proc.unref();
  });
}

async function cmdStart(wantEmber: boolean, wantOpenclaw: boolean): Promise<void> {
  const config = loadConfig();
  const pids = readPids();

  const procs: ChildProcess[] = [];
  const stopAll = () => procs.forEach((p) => p.kill("SIGTERM"));

  try {
    if (wantEmber) {
      if (isAlive(pids.ember)) {
        console.log("[ember] 已运行 (pid %d)，跳过。如需重启请先 eb stop", pids.ember);
      } else {
        const p = await spawnEmber();
        procs.push(p);
        console.log(`[ember] EmberBot 网关已启动 (pid ${p.pid ?? "?"})`);
        pids.ember = p.pid ?? null;
        writePids(pids);
      }
    }

    if (wantOpenclaw) {
      if (isAlive(pids.openclaw)) {
        console.log("[openclaw] 已运行 (pid %d)，跳过。", pids.openclaw);
      } else {
        try {
          const p = await startOpenclaw(config.openclawCmd);
          procs.push(p);
          console.log(`[openclaw] 网关已启动 (pid ${p.pid ?? "?"})，命令: ${config.openclawCmd}`);
          pids.openclaw = p.pid ?? null;
          writePids(pids);
        } catch (err) {
          console.error(`[openclaw] 启动失败: ${(err as Error).message}`);
          console.error("[openclaw] 请确认已安装 openclaw，或用 config.json 的 openclawCmd 指定命令（如 openclaw-cn gateway）。");
        }
      }
    }

    console.log("\n已在运行: EmberBot + OpenClaw。按 Ctrl+C 或执行 `eb stop` 停止。");
  } catch (err) {
    stopAll();
    console.error("启动失败:", (err as Error).message);
    process.exitCode = 1;
  }
}

function cmdStop(all: boolean): void {
  const pids = readPids();
  if (all || pids.ember) {
    killPid(pids.ember);
    if (pids.ember) console.log("[ember] 已停止");
  }
  if (all || pids.openclaw) {
    killPid(pids.openclaw);
    if (pids.openclaw) console.log("[openclaw] 已停止");
  }
  if (all) clearPids();
}

function cmdStatus(): void {
  const pids = readPids();
  console.log(
    `[ember]    ${pids.ember && isAlive(pids.ember) ? `运行中 (pid ${pids.ember})` : "未运行"}`
  );
  console.log(
    `[openclaw] ${pids.openclaw && isAlive(pids.openclaw) ? `运行中 (pid ${pids.openclaw})` : "未运行"}`
  );
}

const LOG_TARGETS = {
  ember: join(LOG_DIR, "ember.log"),
  openclaw: join(LOG_DIR, "openclaw.log"),
} as const;

type LogName = keyof typeof LOG_TARGETS;

function tailLines(file: string, count: number): string[] {
  if (!existsSync(file)) return [];
  try {
    const lines = readFileSync(file, "utf-8").split("\n");
    return lines.slice(-count);
  } catch {
    return [];
  }
}

function cmdLogs(follow: boolean, target: LogName | null, count: number): void {
  const names: LogName[] = target ? [target] : ["ember", "openclaw"];

  const printAll = (first = false) => {
    let out = "";
    for (const name of names) {
      const lines = tailLines(LOG_TARGETS[name], count);
      if (lines.length) {
        out += `${first ? "" : "\n"}${"=".repeat(20)} ${name} ${"=".repeat(20)}\n`;
        out += lines.join("\n") + "\n";
      }
    }
    if (out) process.stdout.write(out);
    if (!follow && !out) console.log("(暂无日志)");
  };

  printAll(true);

  if (!follow) return;

  for (const name of names) {
    const file = LOG_TARGETS[name];
    let lastSize = existsSync(file) ? readFileSync(file, "utf-8").length : 0;
    watchFile(file, { interval: 500 }, (curr) => {
      const newSize = curr.size;
      if (newSize > lastSize) {
        try {
          const content = readFileSync(file, "utf-8");
          const delta = content.slice(lastSize);
          if (delta) {
            process.stdout.write(`\n${"=".repeat(20)} ${name} ${"=".repeat(20)}\n`);
            process.stdout.write(delta.endsWith("\n") ? delta : delta + "\n");
          }
        } catch {
          /* 读文件失败忽略 */
        }
      }
      lastSize = Math.max(newSize, lastSize);
    });
  }

  console.log(`\n(跟随日志中，按 Ctrl+C 退出)`);
  // 保持进程存活以持续监听
  process.stdin.resume();
  process.on("SIGINT", () => process.exit(0));
}

function cmdInfo(): void {
  const config = loadConfig();
  console.log("EmberBot 配置摘要");
  console.log(`  端口           ${config.port}`);
  console.log(`  模型名         ${config.modelName}`);
  console.log(`  API Key        ${config.apiKey ? "已设置" : "(空，不校验)"}`);
  console.log(`  Python         ${config.pythonPath}`);
  console.log(`  插件目录       ${config.pluginsDir}`);
  console.log(`  LLM Provider   ${config.provider}${config.provider === "null" ? "（占位，未接真实模型）" : ""}`);
  console.log(`  OpenClaw 命令  ${config.openclawCmd}`);
  console.log(`  侧车超时       ${config.requestTimeoutMs}ms`);
}

/** 极简解析 metadata.yaml 的 key: value 行，无需 YAML 库 */
function parseMetadata(file: string): Record<string, string> {
  const meta: Record<string, string> = {};
  if (!existsSync(file)) return meta;
  try {
    const lines = readFileSync(file, "utf-8").split("\n");
    for (const line of lines) {
      const m = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
  } catch {
    /* 忽略解析失败 */
  }
  return meta;
}

function cmdPlugins(): void {
  const config = loadConfig();
  const dir = config.pluginsDir;
  if (!existsSync(dir) || !readdirSync(dir).length) {
    console.log(`插件目录为空或不存在: ${dir}`);
    return;
  }

  const found: Array<{ name: string; version: string; desc: string; author: string }> = [];
  for (const entry of readdirSync(dir).sort()) {
    const pdir = join(dir, entry);
    if (!existsSync(join(pdir, "main.py"))) continue;
    const meta = parseMetadata(join(pdir, "metadata.yaml"));
    if (!meta.name) continue;
    found.push({
      name: meta.name,
      version: meta.version ?? "?",
      desc: meta.desc ?? "",
      author: meta.author ?? "",
    });
  }

  if (!found.length) {
    console.log(`在 ${dir} 下未发现任何插件（需含 metadata.yaml + main.py）`);
    return;
  }
  console.log(`已发现 ${found.length} 个 AstrBot 插件：\n`);
  for (const p of found) {
    const v = /^v/i.test(p.version) ? p.version : `v${p.version}`;
    console.log(`  • ${p.name}  ${v}${p.author ? `  by ${p.author}` : ""}`);
    if (p.desc) console.log(`      ${p.desc}`);
  }
  console.log(`\n（详情：./eb logs 查看运行时的插件加载日志；加载需先 ./eb start）`);
}

async function cmdTest(msg: string): Promise<void> {
  const config = loadConfig();
  const url = `http://127.0.0.1:${config.port}/v1/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  const body = JSON.stringify({
    model: config.modelName,
    messages: [{ role: "user", content: msg }],
  });

  try {
    const resp = await fetch(url, { method: "POST", headers, body });
    const data: any = await resp.json();
    if (resp.ok) {
      const content = data.choices?.[0]?.message?.content ?? JSON.stringify(data);
      console.log(`回复: ${content}`);
    } else {
      console.error(`错误 (HTTP ${resp.status}): ${data.error?.message ?? JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error(`请求失败: ${(err as Error).message}`);
    console.error("提示: 请先执行 `./eb start` 启动网关。");
    process.exitCode = 1;
  }
}

function cmdVersion(): void {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    console.log(`eb v${pkg.version}`);
  } catch {
    console.log("eb (unknown version)");
  }
}

/** 执行命令探测，返回 stdout（失败返回 null）。超时 3s。 */
function probe(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolveProbe) => {
    let out = "";
    let done = false;
    const finish = (v: string | null) => {
      if (!done) {
        done = true;
        resolveProbe(v);
      }
    };
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      finish(null);
    }, 3000);
    proc.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    proc.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      finish(code === 0 ? out.trim() : null);
    });
  });
}

async function cmdDoctor(): Promise<void> {
  const config = loadConfig();
  const rows: Array<[string, string, boolean]> = [];

  // Node 版本（EmberBot 需要 ≥22 以支持 TS 直跑）
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  rows.push([
    "Node.js",
    nodeMajor >= 22 ? `v${process.versions.node} (≥22 ✓)` : `v${process.versions.node}（需 ≥22）`,
    nodeMajor >= 22,
  ]);

  // Python 可用性（sidecar 需要）
  const pyOut = await probe(config.pythonPath, ["--version"]);
  rows.push([
    `Python (${config.pythonPath})`,
    pyOut ?? "不可用（sidecar 无法运行插件）",
    !!pyOut,
  ]);

  // 插件目录
  const pluginCount = existsSync(config.pluginsDir)
    ? readdirSync(config.pluginsDir).filter((e) =>
        existsSync(join(config.pluginsDir, e, "main.py"))
      ).length
    : 0;
  rows.push([
    "插件目录",
    pluginCount ? `${config.pluginsDir}（${pluginCount} 个插件）` : `${config.pluginsDir}（无插件）`,
    true,
  ]);

  // openclaw 安装状态
  const ocCmd = config.openclawCmd.trim().split(/\s+/)[0];
  const ocOut = await probe(ocCmd, ["--version"]);
  rows.push([
    `OpenClaw (${ocCmd})`,
    ocOut ?? `未安装（${config.openclawCmd} 将无法启动，但 EmberBot 可单独运行）`,
    !!ocOut,
  ]);

  // 网关连通性
  let gwOk = false;
  let gwMsg = `未运行（http://127.0.0.1:${config.port}）`;
  try {
    const resp = await fetch(`http://127.0.0.1:${config.port}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    });
    gwOk = resp.ok;
    gwMsg = gwOk ? `运行中 (http://127.0.0.1:${config.port}/v1)` : `HTTP ${resp.status}`;
  } catch {
    /* keep default */
  }
  rows.push(["EmberBot 网关", gwMsg, true]);

  console.log("EmberBot 环境自检\n");
  for (const [item, msg, ok] of rows) {
    console.log(`  ${ok ? "✓" : "✗"} ${item.padEnd(24)} ${msg}`);
  }
  const failed = rows.filter((r) => !r[2]).length;
  console.log(
    failed ? `\n${failed} 项异常，请按提示处理。` : "\n全部正常，可以 ./eb start 了。"
  );
  if (failed) process.exitCode = 1;
}

function printHelp(): void {
  console.log(`EmberBot CLI

用法:
  eb start          启动 EmberBot 网关 + OpenClaw（同步）
  eb stop           停止 EmberBot + OpenClaw
  eb restart        重启 EmberBot + OpenClaw
  eb status         查看运行状态
  eb doctor         环境自检（Node/Python/openclaw/插件/网关）
  eb info           查看配置摘要
  eb plugins        列出 plugins/ 下的 AstrBot 插件
  eb test [消息]    向本地网关发一条测试消息（默认 /helloworld）
  eb gateway        仅启动 EmberBot 网关
  eb stop-em        仅停止 EmberBot
  eb openclaw       仅启动 OpenClaw
  eb logs           查看日志（尾部），可加 -f 跟随、<ember|openclaw> 指定
  eb -v, --version  显示版本号
  eb help           显示帮助

说明:
  - EmberBot 对外暴露 OpenAI 兼容接口 (http://127.0.0.1:<port>/v1)
  - LLM 由用户自行提供：在 OpenClaw 的模型配置里把 provider 指向 EmberBot 即可
  - OpenClaw 启动命令可在 config.json 的 openclawCmd 配置（默认 "openclaw gateway"）
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const openclawCmd = config.openclawCmd;

  const [cmd] = args;
  switch (cmd) {
    case "start":
    case "restart":
      if (cmd === "restart") {
        cmdStop(true);
        // 稍等旧进程退出
        await new Promise((r) => setTimeout(r, 500));
      }
      await cmdStart(true, true);
      break;
    case "gateway":
      await cmdStart(true, false);
      break;
    case "openclaw":
      await cmdStart(false, true);
      break;
    case "stop":
      cmdStop(true);
      break;
    case "stop-em":
      cmdStop(false);
      break;
    case "status":
      cmdStatus();
      break;
    case "doctor":
      await cmdDoctor();
      break;
    case "info":
      cmdInfo();
      break;
    case "plugins":
    case "list":
      cmdPlugins();
      break;
    case "test": {
      const msg = args.slice(1).join(" ") || "/helloworld";
      await cmdTest(msg);
      break;
    }
    case "-v":
    case "--version":
    case "version":
      cmdVersion();
      break;
    case "logs": {
      const rest = args.slice(1);
      const follow = rest.includes("-f") || rest.includes("--follow");
      const nIdx = rest.indexOf("-n");
      const count = nIdx >= 0 && rest[nIdx + 1] ? Number(rest[nIdx + 1]) : 50;
      const targetArg = rest.find((a) => a === "ember" || a === "openclaw");
      const target: LogName | null =
        targetArg === "ember" || targetArg === "openclaw" ? targetArg : null;
      cmdLogs(follow, target, Number.isFinite(count) ? count : 50);
      break;
    }
    case "help":
    case "-h":
    case "--help":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`未知命令: ${cmd}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});