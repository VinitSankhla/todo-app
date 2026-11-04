import { generateClient } from 'aws-amplify/data';
import type { Schema } from '../../amplify/data/resource';
import { ASSISTANT_ERROR_TYPES } from '../../shared/assistant-limits';

/**
 * Talks to the AI assistant's conversation route (Amplify AI Kit).
 * A chat ("conversation") is stored on the server and only its owner can read it.
 */

export interface AssistantHandlers {
  /** A piece of reply text for the user message `messageId`. */
  onText(messageId: string, blockIndex: number, deltaIndex: number, text: string): void;
  /** The assistant finished replying to `messageId` (it may have changed tasks). */
  onDone(messageId: string): void;
  /** The reply to `messageId` failed; `message` is safe to show the user. */
  onError(messageId: string | null, message: string): void;
}

export interface AssistantChat {
  /** Sends a message; resolves with its id once the server has stored it. */
  send(text: string): Promise<string>;
  close(): void;
}

export const ASSISTANT_UNAVAILABLE =
  'The assistant is unavailable right now. You can still manage your tasks with the buttons.';

// Errors the assistant's server code reports on purpose; their messages are written for users.
const USER_FACING_ERRORS = new Set<string>(Object.values(ASSISTANT_ERROR_TYPES));

/** A user-friendly message for a failed reply; never shows raw technical errors. */
export function assistantErrorMessage(
  errors: ReadonlyArray<{ errorType?: string; message?: string }>,
) {
  const known = errors.find((error) => error.errorType && USER_FACING_ERRORS.has(error.errorType));
  return known?.message ?? ASSISTANT_UNAVAILABLE;
}

/**
 * Removes the model's private reasoning from a reply. Amazon Nova writes it inside
 * <thinking>…</thinking> tags; while a reply streams in, the closing tag may not have arrived yet.
 */
export function visibleReply(text: string): string {
  let visible = text
    .replace(/<thinking>[\s\S]*?<\/thinking>/g, '')
    .replace(/<thinking>[\s\S]*$/, '');
  const partialTag = /<[a-z/]*$/.exec(visible);
  if (partialTag && '<thinking>'.startsWith(partialTag[0])) {
    visible = visible.slice(0, partialTag.index);
  }
  return visible.trim();
}

let client: ReturnType<typeof generateClient<Schema>> | undefined;

function getClient() {
  client ??= generateClient<Schema>();
  return client;
}

/** The browser's time zone, so "tomorrow" means tomorrow where the user is. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Starts a new chat and listens for replies. Throws if the assistant is unavailable. */
export async function startAssistantChat(handlers: AssistantHandlers): Promise<AssistantChat> {
  const { data: conversation, errors } = await getClient().conversations.assistant.create();
  if (errors?.length || !conversation) throw new Error(ASSISTANT_UNAVAILABLE);

  const subscription = conversation.onStreamEvent({
    next(event) {
      if (event.text !== undefined) {
        handlers.onText(
          event.associatedUserMessageId,
          event.contentBlockIndex,
          event.contentBlockDeltaIndex,
          event.text,
        );
      } else if (event.stopReason !== undefined) {
        handlers.onDone(event.associatedUserMessageId);
      }
    },
    error(event) {
      handlers.onError(
        event.associatedUserMessageId ?? null,
        assistantErrorMessage(event.errors ?? []),
      );
    },
  });

  return {
    async send(text) {
      const { data, errors: sendErrors } = await conversation.sendMessage({
        content: [{ text }],
        aiContext: { timeZone: browserTimeZone() },
      });
      if (sendErrors?.length || !data) throw new Error(ASSISTANT_UNAVAILABLE);
      return data.id;
    },
    close() {
      subscription.unsubscribe();
    },
  };
}
