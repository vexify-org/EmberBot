// OpenAI 兼容网关：把 EmberBot 伪装成一个 OpenAI API 服务。
// OpenClaw 只需把模型 provider 指到 http://<host>:<port>/v1 即可接入。
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type {
  ChatCompletionRequest,
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  BridgeChatResult,
} from "../types.ts";
import type { SidecarBridge } from "../bridge/sidecar.ts";
import type { LLMProvider } from "../llm/provider.ts";
import type { EmberConfig } from "../config.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export function createGatewayServer(
  config: EmberConfig,
  bridge: SidecarBridge,
  provider: LLMProvider
) {
  return createServer((req, res) => {
    // 统一 CORS 预检
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const route = `${req.method} ${url.pathname}`;

    try {
      switch (route) {
        case "GET /health":
          json(res, 200, { status: "ok" });
          return;
        case "GET /v1/models":
          handleModels(res, config);
          return;
        case "POST /v1/chat/completions":
          handleChatCompletions(req, res, config, bridge, provider);
          return;
        default:
          json(res, 404, {
            error: { message: `Not found: ${route}`, type: "invalid_request_error" },
          });
      }
    } catch (err) {
      json(res, 500, {
        error: { message: (err as Error).message, type: "internal_error" },
      });
    }
  });
}

function checkAuth(req: IncomingMessage, config: EmberConfig): boolean {
  if (!config.apiKey) return true;
  const header = req.headers["authorization"] ?? "";
  return header === `Bearer ${config.apiKey}`;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

function openAIError(res: ServerResponse, status: number, message: string, type = "invalid_request_error"): void {
  json(res, status, { error: { message, type } });
}

function handleModels(res: ServerResponse, config: EmberConfig): void {
  json(res, 200, {
    object: "list",
    data: [
      {
        id: config.modelName,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "emberbot",
      },
    ],
  });
}

/** 提取消息文本（兼容 string 与 content parts 数组两种格式） */
function extractText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p?.text ?? "").join("");
  return "";
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf-8");
}

async function handleChatCompletions(
  req: IncomingMessage,
  res: ServerResponse,
  config: EmberConfig,
  bridge: SidecarBridge,
  provider: LLMProvider
): Promise<void> {
  if (!checkAuth(req, config)) {
    openAIError(res, 401, "Invalid API key", "authentication_error");
    return;
  }

  let body: ChatCompletionRequest;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    openAIError(res, 400, "请求体不是合法 JSON");
    return;
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    openAIError(res, 400, "messages 不能为空");
    return;
  }

  // 取最后一条用户消息作为本轮输入，交给 AstrBot 插件宿主
  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  const text = lastUser ? extractText(lastUser.content).trim() : "";
  const senderName = lastUser?.name ?? "OpenClaw 用户";

  let result: BridgeChatResult;
  try {
    result = await bridge.chat(text, { id: senderName, name: senderName });
  } catch (err) {
    openAIError(res, 502, `插件宿主调用失败: ${(err as Error).message}`, "api_error");
    return;
  }

  // 命中插件指令 → 直接返回插件回复；未命中 → 走 LLM Provider
  let content: string;
  if (result.matched && result.reply.trim()) {
    content = result.reply;
  } else {
    try {
      content = await provider.chat(body.messages, { model: body.model });
    } catch (err) {
      openAIError(res, 502, (err as Error).message, "api_error");
      return;
    }
  }

  const id = `chatcmpl-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const created = Math.floor(Date.now() / 1000);
  const model = body.model ?? config.modelName;
  const promptTokens = Math.ceil(
    body.messages.reduce((n, m) => n + extractText(m.content).length, 0) / 4
  );
  const completionTokens = Math.ceil(content.length / 4);

  if (body.stream) {
    sendStream(res, { id, created, model }, content);
    return;
  }

  const response: ChatCompletionResponse = {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
  json(res, 200, response);
}

function sendStream(
  res: ServerResponse,
  base: { id: string; created: number; model: string },
  content: string
): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const writeChunk = (chunk: ChatCompletionChunk) => {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  };

  writeChunk({
    ...base,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  });

  // 按 24 字符切片模拟流式输出
  const STEP = 24;
  for (let i = 0; i < content.length; i += STEP) {
    writeChunk({
      ...base,
      object: "chat.completion.chunk",
      choices: [
        { index: 0, delta: { content: content.slice(i, i + STEP) }, finish_reason: null },
      ],
    });
  }

  writeChunk({
    ...base,
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  });
  res.write("data: [DONE]\n\n");
  res.end();
}
