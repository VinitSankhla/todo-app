import { a, defineData, type ClientSchema } from '@aws-amplify/backend';
import { ASSISTANT_MAX_OUTPUT_TOKENS } from '../../shared/assistant-limits';
import { ASSISTANT_MODEL, assistantHandler } from '../assistant/resource';
import { ASSISTANT_SYSTEM_PROMPT } from '../assistant/system-prompt';

/**
 * Task data model. Every task belongs to the user who created it:
 * - Reads (get / list) and deletes go through Amplify's generated resolvers with owner-only auth.
 * - Creates and updates go through the custom `addTask` / `editTask` mutations instead, which
 *   validate input on the server and set or check `owner` from the caller's Cognito identity.
 *   The generated create/update mutations are disabled so they cannot bypass that validation.
 * @see https://docs.amplify.aws/react/build-a-backend/data/
 */
const schema = a.schema({
  Task: a
    .model({
      title: a.string().required(),
      description: a.string(),
      dueDate: a.date(),
      done: a.boolean().required(),
      owner: a.string(),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    // Query one user's tasks by owner (newest first) instead of scanning the whole table.
    .secondaryIndexes((index) => [
      index('owner').sortKeys(['createdAt']).queryField('listTasksByOwner'),
    ])
    .disableOperations(['create', 'update', 'subscriptions'])
    .authorization((allow) => [allow.owner()]),

  addTask: a
    .mutation()
    .arguments({
      title: a.string().required(),
      description: a.string(),
      dueDate: a.date(),
    })
    .returns(a.ref('Task'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.custom({ dataSource: a.ref('Task'), entry: './add-task.js' })),

  editTask: a
    .mutation()
    .arguments({
      id: a.id().required(),
      title: a.string(),
      description: a.string(),
      // A string (validated as YYYY-MM-DD in the resolver) so "" can clear the date:
      // a null argument is indistinguishable from an omitted one in the resolver.
      dueDate: a.string(),
      done: a.boolean(),
    })
    .returns(a.ref('Task'))
    .authorization((allow) => [allow.authenticated()])
    .handler(a.handler.custom({ dataSource: a.ref('Task'), entry: './edit-task.js' })),

  // AI assistant chat. Each user can only see and use their own chats (owner authorization).
  // The handler Lambda (amplify/assistant/) checks limits and gives the model task tools that
  // call the operations above with the user's own login.
  assistant: a
    .conversation({
      aiModel: ASSISTANT_MODEL,
      systemPrompt: ASSISTANT_SYSTEM_PROMPT,
      inferenceConfiguration: { maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS, temperature: 0.2 },
      handler: assistantHandler,
    })
    .authorization((allow) => allow.owner()),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
