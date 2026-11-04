import {
  handleConversationTurnEvent,
  type ConversationTurnEvent,
} from '@aws-amplify/backend-ai/conversation/runtime';
import { isValidTimeZone, todayInTimeZone } from './dates';
import {
  callerFromAuthorization,
  checkMessage,
  messageText,
  RATE_LIMIT_ERRORS,
  timeZoneFromContext,
  type GuardError,
  type StoredMessage,
} from './guard';
import { dateContext } from './system-prompt';
import { createGraphqlRequest, createTaskClient, type GraphqlRequest } from './task-client';
import { createTools } from './tools';
import { createDynamoStore, type AssistantStore } from './usage-store';

/**
 * Runs once per message the user sends to the assistant (AppSync invokes it; browsers cannot).
 * 1. Checks the message (text only, length) and the user's rate limits — before any AI cost.
 * 2. Adds today's date in the user's time zone to the system prompt.
 * 3. Lets Amplify's conversation runtime call the AI model with the task tools below.
 */

type StoredMessageWithDate = StoredMessage & { createdAt: string };

const MESSAGE_FIELDS = `id role createdAt aiContext
  content { text image { format } document { format } toolUse { toolUseId } toolResult { toolUseId } }`;

async function loadHistory(
  request: GraphqlRequest,
  event: ConversationTurnEvent,
): Promise<StoredMessageWithDate[]> {
  const { listQueryName, listQueryInputTypeName, getQueryName, getQueryInputTypeName } =
    event.messageHistoryQuery;
  const listed = await request(
    `query ListMessages($filter: ${listQueryInputTypeName}!, $limit: Int) {
      ${listQueryName}(filter: $filter, limit: $limit) { items { ${MESSAGE_FIELDS} } }
    }`,
    { filter: { conversationId: { eq: event.conversationId } }, limit: 1000 },
  );
  const messages = (listed[listQueryName] as { items: StoredMessageWithDate[] }).items;
  // A message written a moment ago may not be listed yet (eventually consistent reads).
  if (!messages.some((message) => message.id === event.currentMessageId)) {
    const fetched = await request(
      `query GetMessage($id: ${getQueryInputTypeName}!) { ${getQueryName}(id: $id) { ${MESSAGE_FIELDS} } }`,
      { id: event.currentMessageId },
    );
    const current = fetched[getQueryName] as StoredMessageWithDate | null;
    if (!current) throw new Error('The message could not be found.');
    messages.push(current);
  }
  return messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Sends a refusal to the chat panel through the same mutation the AI runtime uses for errors. */
async function sendError(
  request: GraphqlRequest,
  event: ConversationTurnEvent,
  error: GuardError,
): Promise<void> {
  const { name, inputTypeName, selectionSet } = event.responseMutation;
  await request(
    `mutation PublishModelResponse($input: ${inputTypeName}!) { ${name}(input: $input) { ${selectionSet} } }`,
    {
      input: {
        conversationId: event.conversationId,
        associatedUserMessageId: event.currentMessageId,
        errors: [error],
      },
    },
  );
}

export interface HandlerDependencies {
  store: AssistantStore;
  request: GraphqlRequest;
  now: Date;
  runTurn: typeof handleConversationTurnEvent;
}

export async function handleAssistantTurn(
  event: ConversationTurnEvent,
  deps: HandlerDependencies,
): Promise<void> {
  const { store, request, now } = deps;
  let tools;
  let systemPrompt;
  try {
    const caller = callerFromAuthorization(event.request.headers.authorization);
    const history = await loadHistory(request, event);
    const current = history.find((message) => message.id === event.currentMessageId);
    if (!current) throw new Error('The message could not be found.');

    const refusal = checkMessage(current, history);
    if (refusal) return await sendError(request, event, refusal);
    const limited = await store.countRequest(caller.sub, now);
    if (limited) return await sendError(request, event, RATE_LIMIT_ERRORS[limited]);

    const timeZone = timeZoneFromContext(current.aiContext, isValidTimeZone);
    const today = todayInTimeZone(now, timeZone);
    const userMessages = history.filter((message) => message.role === 'user');
    const currentIndex = userMessages.findIndex((message) => message.id === current.id);

    tools = createTools({
      tasks: createTaskClient(request, `${caller.sub}::${caller.username}`),
      store,
      userId: caller.sub,
      conversationId: event.conversationId,
      currentMessageId: current.id,
      currentText: messageText(current),
      previousUserMessageId: userMessages[currentIndex - 1]?.id,
      today,
    });
    systemPrompt = event.modelConfiguration.systemPrompt + dateContext(today, timeZone);
  } catch (error) {
    console.error('Assistant pre-check failed', error);
    await sendError(request, event, {
      errorType: 'AssistantUnavailable',
      message: 'The assistant is unavailable right now.',
    });
    throw error;
  }

  await deps.runTurn(
    { ...event, modelConfiguration: { ...event.modelConfiguration, systemPrompt } },
    { tools },
  );
}

export const handler = async (event: ConversationTurnEvent): Promise<void> => {
  const tableName = process.env.ASSISTANT_TABLE_NAME;
  if (!tableName) throw new Error('ASSISTANT_TABLE_NAME is not set.');
  await handleAssistantTurn(event, {
    store: createDynamoStore(tableName),
    request: createGraphqlRequest(event.graphqlApiEndpoint, event.request.headers.authorization),
    now: new Date(),
    runTurn: handleConversationTurnEvent,
  });
};
