import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { parseModelJson, type Prompt } from "@proof/core";

export type ProviderId = "anthropic" | "openai" | "openai-compatible";

export interface AiConfig {
  provider: ProviderId;
  model: string;
  /** Required for openai-compatible (self-hosted, OpenRouter, etc.). */
  baseUrl?: string;
  apiKey: string;
  /** For tests. */
  fetch?: typeof fetch;
}

export interface Usage {
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiResult<T> {
  output: T;
  usage: Usage;
}

/** The model is unavailable or declined; callers skip the AI part of the report. */
export class AiUnavailableError extends Error {}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: "claude-opus-5-5",
  openai: "",
  "openai-compatible": "",
};

/**
 * One interface over every provider an org can pick. Prompts come from @proof/core,
 * and every reply is validated against the prompt's schema before it is used.
 */
export interface ModelGateway {
  run<T>(prompt: Prompt<T>): Promise<AiResult<T>>;
}

export function createGateway(config: AiConfig): ModelGateway {
  return config.provider === "anthropic" ? anthropicGateway(config) : openaiGateway(config);
}

function anthropicGateway(config: AiConfig): ModelGateway {
  const client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 120_000, fetch: config.fetch });
  return {
    async run<T>(prompt: Prompt<T>): Promise<AiResult<T>> {
      let response: Anthropic.Beta.BetaMessage;
      try {
        response = await client.beta.messages.create({
          model: config.model,
          // Thinking counts toward max_tokens on current models, so leave room beyond the answer itself.
          max_tokens: 16000,
          // Short, structured tasks: low effort keeps cost and latency down.
          output_config: { effort: "low" },
          // If the model declines, the API retries on a suitable fallback model in the same call.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw new AiUnavailableError("The Anthropic API key was rejected");
        if (err instanceof Anthropic.RateLimitError) throw new AiUnavailableError("Anthropic rate limit reached");
        if (err instanceof Anthropic.APIError) throw new AiUnavailableError(`Anthropic API error ${err.status}`);
        throw err;
      }
      if (response.stop_reason === "refusal") throw new AiUnavailableError("The model declined this request");
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      return {
        output: parseModelJson(text, prompt.schema),
        usage: { provider: "anthropic", model: response.model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}

function openaiGateway(config: AiConfig): ModelGateway {
  if (config.provider === "openai-compatible" && !config.baseUrl) throw new Error("openai-compatible needs a base URL");
  const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl, maxRetries: 2, timeout: 120_000, fetch: config.fetch });
  return {
    async run<T>(prompt: Prompt<T>): Promise<AiResult<T>> {
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        response = await client.chat.completions.create({
          model: config.model,
          max_completion_tokens: Math.max(prompt.maxTokens, 4000),
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: prompt.system },
            { role: "user", content: prompt.user },
          ],
        });
      } catch (err) {
        if (err instanceof OpenAI.APIError) throw new AiUnavailableError(`${config.provider} API error ${err.status ?? ""}`.trim());
        throw err;
      }
      const choice = response.choices[0];
      if (!choice?.message.content) throw new AiUnavailableError("The model returned no content");
      return {
        output: parseModelJson(choice.message.content, prompt.schema),
        usage: {
          provider: config.provider,
          model: response.model,
          inputTokens: response.usage?.prompt_tokens ?? 0,
          outputTokens: response.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}
