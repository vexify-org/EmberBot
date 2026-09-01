// LLM Provider 抽象接口。
// EmberBot 内部的「大脑」对话能力从哪来，由实现此接口的 Provider 决定。
// 目前只内置 NullProvider（未接模型时的占位回复），后续可在此注册真实 Provider。
import type { ChatMessage } from "../types.ts";

export interface LLMProvider {
  /** Provider 标识，与配置中的 provider 字段对应 */
  readonly id: string;
  /** 用完整对话历史生成一段回复文本 */
  chat(messages: ChatMessage[], opts?: Record<string, unknown>): Promise<string>;
}

/** 占位 Provider：未配置任何上游模型时使用，直接返回提示文本 */
class NullProvider implements LLMProvider {
  readonly id = "null";

  async chat(
    messages: ChatMessage[],
    opts?: Record<string, unknown>
  ): Promise<string> {
    const model = opts?.model ? ` (model=${String(opts.model)})` : "";
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const preview = lastUser ? extractText(lastUser.content).slice(0, 80) : "";
    return (
      `[EmberBot] 未配置 LLM Provider${model}。` +
      `本条消息没有命中任何 AstrBot 插件指令（收到: "${preview}"）。` +
      `请在 config.json 中接入模型，或向插件发送已注册的指令（如 /helloworld）。`
    );
  }
}

function extractText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => p?.text ?? "").join("");
  return "";
}

const registry = new Map<string, LLMProvider>();

export function registerProvider(provider: LLMProvider): void {
  registry.set(provider.id, provider);
}

export function getProvider(id: string): LLMProvider {
  const provider = registry.get(id);
  if (!provider) {
    throw new Error(
      `[emberbot] 未注册的 LLM provider: "${id}"，可选: ${[...registry.keys()].join(", ")}`
    );
  }
  return provider;
}

// 内置 Provider 注册
registerProvider(new NullProvider());
