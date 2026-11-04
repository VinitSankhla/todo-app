// AI assistant limits, shared by the chat panel (browser) and the assistant Lambda (server).
// The server enforces every one of these; the browser checks them only for faster feedback.

/** Longest message a user can send to the assistant, in characters. */
export const ASSISTANT_MAX_MESSAGE_LENGTH = 500;
/** Messages per user per minute. */
export const ASSISTANT_REQUESTS_PER_MINUTE = 6;
/** Messages per user per day (UTC day). */
export const ASSISTANT_REQUESTS_PER_DAY = 60;
/** Longest reply the model may write, in tokens (roughly 300 words). */
export const ASSISTANT_MAX_OUTPUT_TOKENS = 400;
/** User messages in one chat before the user must start a new chat (keeps each request small). */
export const ASSISTANT_MAX_TURNS_PER_CHAT = 20;
/** Tool calls the model may make while answering one message. */
export const ASSISTANT_MAX_TOOL_CALLS_PER_TURN = 8;

/** Error types the assistant Lambda reports to the chat panel. */
export const ASSISTANT_ERROR_TYPES = {
  messageTooLong: 'MessageTooLong',
  rateLimited: 'RateLimited',
  dailyLimit: 'DailyLimitReached',
  chatFull: 'ChatFull',
  unsupportedContent: 'UnsupportedContent',
} as const;
