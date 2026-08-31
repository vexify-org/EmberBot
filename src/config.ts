// 配置加载：config.json 优先，环境变量覆盖
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

export interface EmberConfig {
  port: number;
  apiKey: string;
  modelName: string;
  pythonPath: string;
  pluginsDir: string;
  provider: string;
  requestTimeoutMs: number;
}

interface RawConfig {
  port?: number;
  apiKey?: string;
  modelName?: string;
  pythonPath?: string;
  pluginsDir?: string;
  provider?: string;
  requestTimeoutMs?: number;
}

function loadConfigFile(): RawConfig {
  const path = join(ROOT, "config.json");
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`[emberbot] config.json 解析失败: ${err}`);
    return {};
  }
}

export function loadConfig(): EmberConfig {
  const file = loadConfigFile();
  return {
    port: Number(process.env.EMBER_PORT ?? file.port ?? 3737),
    apiKey: process.env.EMBER_API_KEY ?? file.apiKey ?? "",
    modelName: process.env.EMBER_MODEL_NAME ?? file.modelName ?? "emberbot",
    pythonPath: process.env.EMBER_PYTHON ?? file.pythonPath ?? "python3",
    pluginsDir: resolve(
      ROOT,
      process.env.EMBER_PLUGINS_DIR ?? file.pluginsDir ?? "./plugins"
    ),
    provider: process.env.EMBER_PROVIDER ?? file.provider ?? "null",
    requestTimeoutMs: Number(
      process.env.EMBER_TIMEOUT_MS ?? file.requestTimeoutMs ?? 60_000
    ),
  };
}
