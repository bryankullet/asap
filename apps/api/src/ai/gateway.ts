import { AiGatewayError, type AiProvider, type AiProviderId } from "@asap/schema";
import type { ServerEnv } from "@asap/schema/env/server";
import type { Logger } from "pino";
import { openAiProvider } from "./providers/openai.js";
import { fakeProvider } from "./providers/fake.js";

/**
 * Provider selection. One place, from server-side configuration, resolved at boot.
 *
 * When nothing is configured the gateway is **absent**, not broken. Ask then answers with the
 * `not_configured` state and the UI says a model has not been connected — which is true, and is
 * better than a spinner or an empty result that reads like "nothing found".
 *
 * The browser learns none of this: no provider name, no model, no key. `packages/schema/src/env/
 * public.ts` has no AI variable at all, and the secret scan in lint would catch one arriving.
 */
export function resolveProvider(env: ServerEnv, logger: Logger): AiProvider | null {
  const id = env.AI_DEFAULT_PROVIDER as AiProviderId;

  if (id === "fake") {
    logger.info({ provider: "fake" }, "ai gateway: deterministic provider");
    return fakeProvider();
  }

  if (id === "openai") {
    if (!env.OPENAI_API_KEY || !env.AI_MODEL) {
      logger.warn(
        { missing: [!env.OPENAI_API_KEY && "OPENAI_API_KEY", !env.AI_MODEL && "AI_MODEL"].filter(Boolean) },
        "ai gateway disabled: Ask will answer with the configuration-required state",
      );
      return null;
    }
    logger.info({ provider: "openai", model: env.AI_MODEL }, "ai gateway ready");
    return openAiProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.AI_MODEL,
      timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    });
  }

  // Anthropic is a sibling adapter and one config value. Until it is written, saying so beats
  // silently falling back to another provider, which would make "which model answered?" a guess.
  logger.warn({ provider: id }, "ai gateway disabled: no adapter for the configured provider");
  return null;
}

/** The most tool rounds one question may take. A loop that will not settle is a failure, not a wait. */
export const MAX_TOOL_ROUNDS = 4;

/** Raised when a caller asks the gateway for something and none is configured. */
export function requireProvider(provider: AiProvider | null): AiProvider {
  if (!provider) {
    throw new AiGatewayError(
      "not_configured",
      "No model is connected to this deployment.",
      "Set AI_DEFAULT_PROVIDER, AI_MODEL and the provider's key on the API service.",
    );
  }
  return provider;
}
