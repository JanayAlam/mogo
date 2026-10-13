/**
 * The kinds of LLM connection a user can add. Shared by the server (validation) and the browser (the add form), so
 * keep it free of server imports. Hosted providers have a fixed base URL: an "OpenAI" connection can only talk to
 * OpenAI, so a pasted key cannot be pointed at another host. "custom" is any OpenAI-compatible server.
 */
export const PROVIDERS = ["custom", "openai", "anthropic", "deepseek", "openrouter"] as const;
export type Provider = (typeof PROVIDERS)[number];

export interface ProviderInfo {
  label: string;
  base_url: string; // '' for custom: the user gives it
  key_prefix: string; // what a valid key starts with; '' for custom
  key_hint: string;
  model_hint: string;
}

export const PROVIDER_INFO: Record<Provider, ProviderInfo> = {
  openai: {
    label: "OpenAI",
    base_url: "https://api.openai.com/v1",
    key_prefix: "sk-",
    key_hint: "platform.openai.com > API keys. Starts with sk-",
    model_hint: "e.g. gpt-4.1",
  },
  anthropic: {
    label: "Claude",
    base_url: "https://api.anthropic.com/v1",
    key_prefix: "sk-ant-",
    key_hint: "console.anthropic.com > API keys. Starts with sk-ant-",
    model_hint: "e.g. claude-sonnet-4-5",
  },
  deepseek: {
    label: "DeepSeek",
    base_url: "https://api.deepseek.com",
    key_prefix: "sk-",
    key_hint: "platform.deepseek.com > API keys. Starts with sk-",
    model_hint: "e.g. deepseek-flash",
  },
  openrouter: {
    label: "OpenRouter",
    base_url: "https://openrouter.ai/api/v1",
    key_prefix: "sk-or-",
    key_hint: "openrouter.ai > Keys. Starts with sk-or-",
    model_hint: "e.g. anthropic/claude-sonnet-4.5",
  },
  custom: {
    label: "Local / Custom",
    base_url: "",
    key_prefix: "",
    key_hint: "Only if your server checks one. Ollama and LM Studio do not.",
    model_hint: "the model id your server lists, e.g. qwen2.5-coder:14b",
  },
};

export const isProvider = (v: unknown): v is Provider => PROVIDERS.includes(v as Provider);

/** The model must support tool calling; the review agent depends on it. */
export const MODEL_NOTE = "The model must support tool calling.";
