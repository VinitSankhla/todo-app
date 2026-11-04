import { a } from '@aws-amplify/backend';
import { defineConversationHandlerFunction } from '@aws-amplify/backend-ai/conversation';

/** The AI model behind the assistant. Amazon Nova Lite: low cost, supports tool use. */
export const ASSISTANT_MODEL = a.ai.model('Amazon Nova Lite');

/** The Lambda that runs each assistant message: safety checks, rate limits and task tools. */
export const assistantHandler = defineConversationHandlerFunction({
  name: 'assistant-handler',
  entry: './handler.ts',
  models: [{ modelId: ASSISTANT_MODEL }],
  // A hard stop for one message, including all model and tool calls.
  timeoutSeconds: 30,
  memoryMB: 256,
  logging: { level: 'info', retention: '1 month' },
});
