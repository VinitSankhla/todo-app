import {
  ASSISTANT_ERROR_TYPES,
  ASSISTANT_MAX_MESSAGE_LENGTH,
  ASSISTANT_MAX_TURNS_PER_CHAT,
  ASSISTANT_REQUESTS_PER_DAY,
  ASSISTANT_REQUESTS_PER_MINUTE,
} from '../../shared/assistant-limits';

/** A refusal sent back to the chat panel instead of calling the AI model. */
export interface GuardError {
  errorType: string;
  message: string;
}

/** The parts of a stored chat message the checks below need. */
export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content?: Array<Record<string, unknown> | null> | null;
  aiContext?: unknown;
}

/** The text of a message (all text blocks joined). */
export function messageText(message: StoredMessage): string {
  return (message.content ?? [])
    .map((block) => (block && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

/**
 * Checks the user's new message before anything is sent to the AI model:
 * text only, not too long, and the chat is not over its length limit.
 */
export function checkMessage(
  current: StoredMessage,
  history: readonly StoredMessage[],
): GuardError | null {
  const blocks = (current.content ?? []).filter((block) => block !== null);
  const textOnly = blocks.every((block) =>
    Object.entries(block).every(([key, value]) => key === 'text' || value == null),
  );
  if (!textOnly) {
    return {
      errorType: ASSISTANT_ERROR_TYPES.unsupportedContent,
      message: 'The assistant only accepts text messages.',
    };
  }
  const text = messageText(current).trim();
  if (!text) {
    return { errorType: ASSISTANT_ERROR_TYPES.messageTooLong, message: 'Please type a message.' };
  }
  if (text.length > ASSISTANT_MAX_MESSAGE_LENGTH) {
    return {
      errorType: ASSISTANT_ERROR_TYPES.messageTooLong,
      message: `Messages can be at most ${ASSISTANT_MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  const userTurns = history.filter((message) => message.role === 'user').length;
  if (userTurns > ASSISTANT_MAX_TURNS_PER_CHAT) {
    return {
      errorType: ASSISTANT_ERROR_TYPES.chatFull,
      message: 'This chat is full. Please start a new chat.',
    };
  }
  return null;
}

export const RATE_LIMIT_ERRORS: Record<'minute' | 'day', GuardError> = {
  minute: {
    errorType: ASSISTANT_ERROR_TYPES.rateLimited,
    message: `You can send up to ${ASSISTANT_REQUESTS_PER_MINUTE} messages a minute. Please wait a moment and try again.`,
  },
  day: {
    errorType: ASSISTANT_ERROR_TYPES.dailyLimit,
    message: `You have reached today's limit of ${ASSISTANT_REQUESTS_PER_DAY} assistant messages. You can still manage your tasks with the normal buttons.`,
  },
};

/**
 * Does this message clearly say "yes" (and not also "no")? Deleting a task requires the user's
 * very next message after the assistant asked for confirmation to pass this check.
 */
export function isAffirmative(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z' ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return false;
  if (/\b(no|nope|not|don't|dont|do not|cancel|stop|wait|never|keep)\b/.test(normalized)) {
    return false;
  }
  return /^(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|correct|go ahead|do it|delete it|please do|please delete|haan)\b/.test(
    normalized,
  );
}

/** Reads the time zone the browser sent with the message, falling back to UTC. */
export function timeZoneFromContext(aiContext: unknown, isValid: (tz: string) => boolean): string {
  let context = aiContext;
  if (typeof context === 'string') {
    try {
      context = JSON.parse(context);
    } catch {
      return 'UTC';
    }
  }
  if (context && typeof context === 'object' && 'timeZone' in context) {
    const timeZone = (context as { timeZone: unknown }).timeZone;
    if (typeof timeZone === 'string' && isValid(timeZone)) return timeZone;
  }
  return 'UTC';
}

export interface Caller {
  /** Cognito user id. */
  sub: string;
  /** Cognito username (the value Amplify stores after "::" in each task's owner field). */
  username: string;
}

/**
 * Reads who is calling from the Cognito token AppSync forwarded with the request.
 * AppSync has already verified the token's signature before invoking this Lambda, and only
 * AppSync can invoke it, so decoding (not re-verifying) the token is enough here.
 */
export function callerFromAuthorization(authorization: string | undefined): Caller {
  const token = (authorization ?? '').replace(/^Bearer /i, '');
  const payload = token.split('.')[1];
  if (!payload) throw new Error('Missing user token.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
  const sub = claims.sub;
  const username = claims.username ?? claims['cognito:username'];
  if (typeof sub !== 'string' || typeof username !== 'string') {
    throw new Error('The user token is missing the user id.');
  }
  return { sub, username };
}
