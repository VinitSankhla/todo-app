// @vitest-environment node
import type { ConversationTurnEvent } from '@aws-amplify/backend-ai/conversation/runtime';
import { describe, expect, it, vi } from 'vitest';
import { handleAssistantTurn, type HandlerDependencies } from './handler';
import { fakeStore } from './test-fakes';

const token = `h.${Buffer.from(JSON.stringify({ sub: 'alice-sub', username: 'alice' })).toString('base64url')}.s`;

const event: ConversationTurnEvent = {
  conversationId: 'chat-1',
  currentMessageId: 'msg-2',
  streamResponse: true,
  responseMutation: { name: 'publish', inputTypeName: 'PublishInput', selectionSet: 'id' },
  graphqlApiEndpoint: 'https://example.invalid/graphql',
  modelConfiguration: { modelId: 'amazon.nova-lite-v1:0', systemPrompt: 'BASE PROMPT' },
  request: { headers: { authorization: token } },
  messageHistoryQuery: {
    getQueryName: 'getMessage',
    getQueryInputTypeName: 'ID',
    listQueryName: 'listMessages',
    listQueryInputTypeName: 'MessageFilter',
  },
};

function message(id: string, role: 'user' | 'assistant', text: string, createdAt: string) {
  return {
    id,
    role,
    createdAt,
    aiContext: role === 'user' ? JSON.stringify({ timeZone: 'Asia/Kolkata' }) : null,
    content: [{ text, image: null, document: null, toolUse: null, toolResult: null }],
  };
}

function setup(currentText: string, store = fakeStore()) {
  const history = [
    message('msg-1', 'user', 'Delete buy milk', '2026-11-05T10:00:00Z'),
    message(
      'reply-1',
      'assistant',
      'Delete the task "Buy milk"? Reply yes to confirm.',
      '2026-11-05T10:00:02Z',
    ),
    message('msg-2', 'user', currentText, '2026-11-05T10:00:05Z'),
  ];
  const request = vi.fn<HandlerDependencies['request']>(async (query) => {
    if (query.includes('listMessages')) return { listMessages: { items: history } };
    return { publish: { id: 'x' } };
  });
  const runTurn = vi.fn<HandlerDependencies['runTurn']>(async () => undefined);
  // 20:00 UTC on 5 Nov = 01:30 on 6 Nov in India.
  const deps = { store, request, runTurn, now: new Date('2026-11-05T20:00:00Z') };
  return { deps, request, runTurn };
}

const sentErrors = (request: ReturnType<typeof setup>['request']) =>
  request.mock.calls
    .filter(([query]) => query.includes('PublishModelResponse'))
    .map(([, variables]) => (variables.input as { errors: unknown[] }).errors[0]);

describe('assistant handler', () => {
  it("adds today's date in the user's time zone and passes the task tools", async () => {
    const { deps, runTurn } = setup('Add a task to call the bank tomorrow');
    await handleAssistantTurn(event, deps);
    expect(runTurn).toHaveBeenCalledOnce();
    const [turnEvent, options] = runTurn.mock.calls[0];
    expect(turnEvent.modelConfiguration.systemPrompt).toBe(
      "BASE PROMPT\n\nTODAY: Friday, 6 November 2026 (2026-11-06), user's time zone: Asia/Kolkata.",
    );
    expect(options?.tools?.map((tool) => tool.name)).toEqual([
      'find_tasks',
      'create_task',
      'update_task',
      'request_delete',
      'delete_task',
    ]);
  });

  it('refuses a too-long message without calling the AI model', async () => {
    const { deps, request, runTurn } = setup('x'.repeat(501));
    await handleAssistantTurn(event, deps);
    expect(runTurn).not.toHaveBeenCalled();
    expect(sentErrors(request)).toEqual([expect.objectContaining({ errorType: 'MessageTooLong' })]);
  });

  it.each([
    ['minute', 'RateLimited'],
    ['day', 'DailyLimitReached'],
  ] as const)('refuses when the %s limit is reached', async (limit, errorType) => {
    const store = { ...fakeStore(), countRequest: async () => limit };
    const { deps, request, runTurn } = setup('hi', store);
    await handleAssistantTurn(event, deps);
    expect(runTurn).not.toHaveBeenCalled();
    expect(sentErrors(request)).toEqual([expect.objectContaining({ errorType })]);
  });

  it('counts each request for the calling user', async () => {
    const store = fakeStore();
    const countRequest = vi.spyOn(store, 'countRequest');
    const { deps } = setup('hi', store);
    await handleAssistantTurn(event, deps);
    expect(countRequest).toHaveBeenCalledWith('alice-sub', deps.now);
  });

  it('reports "unavailable" to the chat when something fails before the model is called', async () => {
    const { deps, request, runTurn } = setup('hi');
    request.mockImplementationOnce(async () => {
      throw new Error('network down');
    });
    await expect(handleAssistantTurn(event, deps)).rejects.toThrow('network down');
    expect(runTurn).not.toHaveBeenCalled();
    expect(sentErrors(request)).toEqual([
      expect.objectContaining({ errorType: 'AssistantUnavailable' }),
    ]);
  });
});
