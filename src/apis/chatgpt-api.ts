import OpenAI from "openai";
import { getRemoteConfig } from "../middlewares/authmiddleware";
import { logger } from "../logger/logger";

let openaiClient: OpenAI | null = null;
let initPromise: Promise<OpenAI> | null = null;

async function initOpenAIClient(): Promise<OpenAI> {
  if (openaiClient) return openaiClient;

  if (!initPromise) {
    initPromise = getRemoteConfig()
      .then((response) => {
        const openaiApiKey = (response.openAiApiKey.defaultValue as any)?.value;
        const userAgent = (response.userAgent.defaultValue as any)?.value;

        if (!openaiApiKey) {
          throw new Error("OPENAI_API_KEY not found.");
        }

        const clientConfig: any = {
          apiKey: openaiApiKey,
          timeout: 600000,
          maxRetries: 1,
        };

        if (userAgent) {
          clientConfig.defaultHeaders = { "User-Agent": userAgent };
        }

        openaiClient = new OpenAI(clientConfig);
        logger.info("OpenAI client initialized successfully");
        return openaiClient;
      })
      .catch((e) => {
        logger.error(`Failed to initialize OpenAI client: ${e.message}`);
        throw e;
      });
  }

  return initPromise;
}

export { initOpenAIClient };
