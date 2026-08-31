# EmberBot

EmberBot 是一个**伪装成 OpenAI 兼容网关**的 AI 助手宿主：

- 对外提供一份 OpenAI 兼容 API（`/v1/chat/completions`、`/v1/models`）
- 内部**运行 AstrBot 插件（Star 插件）**，让你已有的 AstrBot skills/插件生态直接复用
- 把插件作为 LLM provider 暴露出去，任何支持 OpenAI 兼容 provider 的客户端都能接入

**典型场景**：OpenClaw 绑定 QQ 机器人（官方 QQ Bot 频道插件）收发消息，把模型的 provider 指向
EmberBot 的 `/v1`。这样 QQ 消息 → OpenClaw → EmberBot → AstrBot 插件，最小代价把 AstrBot
插件生态接到 QQ 上。未命中任何插件指令的消息再回落到 EmberBot 内部的 LLM Provider。

```
QQ 用户
   │  (消息)
   ▼
OpenClaw ── QQ Bot 频道(WebSocket) 绑定 QQ 机器人
   │  (models: emberbot, OpenAI 兼容 provider)
   ▼
EmberBot ─ /v1/chat/completions  (OpenAI 兼容网关, Node)
   │
   ├─ 命中插件指令? ──► Python sidecar ── 加载/运行 AstrBot 插件
   │        └─ 未命中 ──► LLM Provider（占位 NullProvider）
```

## 目录结构

```
src/                      Node/TypeScript 主进程
  index.ts                入口：启动 sidecar + 网关
  config.ts               配置加载
  gateway/server.ts       OpenAI 兼容网关
  bridge/sidecar.ts       Node ↔ Python IPC 桥接（自动重启）
  llm/provider.ts         LLM Provider 抽象（内置 NullProvider）
  types.ts                OpenAI 协议类型
python/                   Python sidecar
  sidecar.py              插件宿主：加载 AstrBot 插件、指令分发
  astrbot/                AstrBot 兼容层（shim），让插件免装 AstrBot 本体
plugins/                  AstrBot 插件目录（每个含 metadata.yaml + main.py）
  astrbot_plugin_helloworld/  示例插件
config.example.json       示例配置
```

## 快速开始

```bash
# 1. 安装依赖（当前零运行时依赖，仅 Node ≥22）
node --version   # 需要 ≥22

# 2. 配置（可选）
cp config.example.json config.json   # 按需修改

# 3. 放入你的 AstrBot 插件
#    把插件目录（含 metadata.yaml + main.py）放到 plugins/ 下

# 4. 启动（推荐：`eb start` 一套启动 EmberBot + OpenClaw，后台运行）
./eb start
# [ember] EmberBot 网关已启动 (pid ...)
# [openclaw] 网关已启动 (pid ...)   ← 未装 openclaw 会给提示但不影响 EmberBot

# 或仅启动 EmberBot 网关
./eb gateway
```

启动后，先把你的 AstrBot 插件放到 `plugins/`，插件会在启动时加载并打印到日志。

## CLI（eb）

| 命令 | 说明 |
| --- | --- |
| `./eb start` | 同步启动 **EmberBot 网关 + OpenClaw**（后台运行，日志在 `data/logs/`） |
| `./eb stop` | 停止 EmberBot + OpenClaw |
| `./eb restart` | 重启 |
| `./eb status` | 查看运行状态 |
| `./eb gateway` | 仅启动 EmberBot 网关 |
| `./eb stop-em` | 仅停止 EmberBot |
| `./eb openclaw` | 仅启动 OpenClaw |
| `./eb logs` | 查看日志尾部；`-f` 跟随、`-n N` 行数、`ember`/`openclaw` 指定 |
| `./eb help` | 帮助 |

> `eb start` 会把进程放到后台（daemon 化），启动后立即返回控制权；日志分别写入
> `data/logs/ember.log` 与 `data/logs/openclaw.log`。OpenClaw 启动命令通过
> `config.json` 的 `openclawCmd` 配置（默认 `openclaw gateway`，也可用 `openclaw-cn gateway`）。

## 对接 OpenClaw + QQ

1. **启动**：`./eb start`（EmberBot 监听 `http://127.0.0.1:3737/v1`，并同步拉起 OpenClaw）。

2. **LLM 由你提供**：EmberBot 只对外暴露 OpenAI 兼容接口，**真实模型你在 OpenClaw
   的模型配置里自己填**——添加一个 OpenAI 兼容 provider，指向 `http://127.0.0.1:3737/v1`，
   `apiKey` 填 EmberBot `config.json` 的 `apiKey`（默认空则放行），模型名填 `modelName`
   （默认 `emberbot`）。

3. **绑定 QQ**（OpenClaw 侧）：安装 QQ 频道插件并绑定机器人，确保 OpenClaw 能收发 QQ 消息：

   ```bash
   openclaw plugins install @openclaw/qqbot
   openclaw channels add --channel qqbot --token "AppID:AppSecret"
   ```

4. **测试**：用手机 QQ 找到你的机器人，发 `/helloworld`，应看到 `Hello, <你的昵称>!`。

## 配置（config.json / 环境变量）

| 字段 | 说明 | 默认 |
| --- | --- | --- |
| `port` / `EMBER_PORT` | 网关端口 | `3737` |
| `apiKey` / `EMBER_API_KEY` | 网关鉴权 key，空则不校验 | `""` |
| `modelName` / `EMBER_MODEL_NAME` | 对外暴露的模型名 | `emberbot` |
| `pythonPath` / `EMBER_PYTHON` | python 可执行文件 | `python3` |
| `pluginsDir` / `EMBER_PLUGINS_DIR` | AstrBot 插件目录 | `./plugins` |
| `provider` / `EMBER_PROVIDER` | 内部 LLM Provider id（未命中插件时使用） | `null` |
| `openclawCmd` / `EMBER_OPENCLAW_CMD` | OpenClaw 启动命令（`eb start` 用） | `openclaw gateway` |
| `requestTimeoutMs` / `EMBER_TIMEOUT_MS` | sidecar 请求超时 | `60000` |

## 接入内部 LLM Provider

EmberBot 内部「大脑」通过 `src/llm/provider.ts` 的 `LLMProvider` 接口抽象，当前只内置
`null` 占位 Provider。接入真实模型时实现该接口并 `registerProvider(...)`，然后把
`config.json` 的 `provider` 设为对应的 `id` 即可。未命中插件指令的消息会走这个 Provider。

## 兼容性说明

- Python sidecar 内置了一份 **AstrBot 兼容层（shim）**（`python/astrbot/`），覆盖插件常
  用的子集：`@register`、`Star`、`Context`、`@filter.command/command_group/regex`、
  `AstrMessageEvent`、`MessageEventResult`、消息组件、`logger`。
- 若插件依赖超出兼容层的 API（如 `context.llm_query`、`context.get_db`），对应调用会抛出
  明确的 `NotImplementedError`。兼容层会持续按需扩展。
- 插件改动后需重启 EmberBot 才会重新加载（当前不做热重载）。
- Apache-2.0 许可。

## 灵感来源

- [AstrBot](https://github.com/AstrBotDevs/AstrBot) —— 插件 API、消息事件、指令过滤器设计与兼容层来源
- [OpenClaw](https://openclaw.ai) / QQ Bot 渠道插件 —— 对接目标