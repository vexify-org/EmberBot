// EmberBot 入口：启动 Python 插件宿主 + OpenAI 兼容网关
import { loadConfig } from "./config.ts";
import { SidecarBridge } from "./bridge/sidecar.ts";
import { createGatewayServer } from "./gateway/server.ts";
import { getProvider } from "./llm/provider.ts";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("[emberbot] 启动中...");
  console.log(`[emberbot] 插件目录: ${config.pluginsDir}`);

  const bridge = new SidecarBridge(
    config.pythonPath,
    config.pluginsDir,
    config.requestTimeoutMs
  );

  const plugins = await bridge.start();
  if (plugins.length === 0) {
    console.warn(
      "[emberbot] 没有加载到任何 AstrBot 插件。把插件目录（含 metadata.yaml + main.py）放入 plugins/ 后重启。"
    );
  }

  const provider = getProvider(config.provider);
  console.log(`[emberbot] LLM provider: ${provider.id}${provider.id === "null" ? "（占位，未接真实模型）" : ""}`);

  const server = createGatewayServer(config, bridge, provider);
  server.listen(config.port, () => {
    console.log(`[emberbot] OpenAI 兼容网关已就绪: http://127.0.0.1:${config.port}/v1`);
    console.log(`[emberbot] 模型名: ${config.modelName}`);
    console.log("[emberbot] 在 OpenClaw 中配置 OpenAI 兼容 provider 指向上述地址即可接入 QQ。");
  });

  const shutdown = () => {
    console.log("[emberbot] 正在关闭...");
    bridge.stop();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[emberbot] 启动失败:", err);
  process.exit(1);
});
