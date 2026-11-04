import { defineConversationHandlerFunction } from '@aws-amplify/backend-ai/conversation';

/**
 * The AI model behind the assistant: Amazon Nova Lite (low cost, supports tool use).
 * In ap-south-1 (Mumbai) it is only offered through the APAC cross-region inference profile,
 * which may process a request in another Asia-Pacific region. Amplify only sets up IAM
 * permissions for "global." profiles itself, so amplify/backend.ts grants this one.
 */
export const ASSISTANT_INFERENCE_PROFILE_ID = 'apac.amazon.nova-lite-v1:0';
export const ASSISTANT_FOUNDATION_MODEL_ID = 'amazon.nova-lite-v1:0';
export const ASSISTANT_MODEL = { resourcePath: ASSISTANT_INFERENCE_PROFILE_ID };

/** The Lambda that runs each assistant message: safety checks, rate limits and task tools. */
export const assistantHandler = defineConversationHandlerFunction({
  name: 'assistant-handler',
  entry: './handler.ts',
  // Bedrock permissions for this model are added in amplify/backend.ts (see above).
  models: [],
  // A hard stop for one message, including all model and tool calls.
  timeoutSeconds: 30,
  memoryMB: 256,
  logging: { level: 'info', retention: '1 month' },
});
