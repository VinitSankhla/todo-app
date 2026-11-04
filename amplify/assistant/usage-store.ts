import {
  ConditionalCheckFailedException,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import {
  ASSISTANT_REQUESTS_PER_DAY,
  ASSISTANT_REQUESTS_PER_MINUTE,
} from '../../shared/assistant-limits';

/**
 * Small server-side state for the assistant, kept in its own DynamoDB table:
 * - per-user request counters (rate limits)
 * - a pending delete per chat (a task the assistant has asked the user to confirm deleting)
 * Every item has an expiry time (`expiresAt`), so DynamoDB removes old items automatically.
 */
export interface AssistantStore {
  /** Counts one request; returns which limit was exceeded, or null when allowed. */
  countRequest(userId: string, now: Date): Promise<'minute' | 'day' | null>;
  getPendingDelete(userId: string, conversationId: string): Promise<PendingDelete | null>;
  setPendingDelete(userId: string, conversationId: string, pending: PendingDelete): Promise<void>;
  clearPendingDelete(userId: string, conversationId: string): Promise<void>;
}

export interface PendingDelete {
  taskId: string;
  title: string;
  /** The user message during which the assistant asked for confirmation. */
  askedInMessageId: string;
}

const PENDING_DELETE_TTL_SECONDS = 15 * 60;

export function createDynamoStore(
  tableName: string,
  client = new DynamoDBClient(),
): AssistantStore {
  async function increment(key: string, limit: number, expiresAt: number): Promise<boolean> {
    try {
      await client.send(
        new UpdateItemCommand({
          TableName: tableName,
          Key: { pk: { S: key } },
          UpdateExpression: 'ADD #count :one SET expiresAt = if_not_exists(expiresAt, :expiresAt)',
          ConditionExpression: 'attribute_not_exists(#count) OR #count < :limit',
          ExpressionAttributeNames: { '#count': 'count' },
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':limit': { N: String(limit) },
            ':expiresAt': { N: String(expiresAt) },
          },
        }),
      );
      return true;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) return false;
      throw error;
    }
  }

  const pendingKey = (userId: string, conversationId: string) =>
    `${userId}#pending-delete#${conversationId}`;

  return {
    async countRequest(userId, now) {
      const seconds = Math.floor(now.getTime() / 1000);
      const minute = Math.floor(seconds / 60);
      const day = now.toISOString().slice(0, 10);
      if (
        !(await increment(
          `${userId}#minute#${minute}`,
          ASSISTANT_REQUESTS_PER_MINUTE,
          seconds + 120,
        ))
      ) {
        return 'minute';
      }
      if (
        !(await increment(`${userId}#day#${day}`, ASSISTANT_REQUESTS_PER_DAY, seconds + 2 * 86400))
      ) {
        return 'day';
      }
      return null;
    },

    async getPendingDelete(userId, conversationId) {
      const { Item } = await client.send(
        new GetItemCommand({
          TableName: tableName,
          Key: { pk: { S: pendingKey(userId, conversationId) } },
          ConsistentRead: true,
        }),
      );
      if (!Item?.taskId?.S || !Item.askedInMessageId?.S) return null;
      // DynamoDB deletes expired items lazily, so check the expiry here as well.
      if (Number(Item.expiresAt?.N ?? 0) < Date.now() / 1000) return null;
      return {
        taskId: Item.taskId.S,
        title: Item.title?.S ?? '',
        askedInMessageId: Item.askedInMessageId.S,
      };
    },

    async setPendingDelete(userId, conversationId, pending) {
      await client.send(
        new PutItemCommand({
          TableName: tableName,
          Item: {
            pk: { S: pendingKey(userId, conversationId) },
            taskId: { S: pending.taskId },
            title: { S: pending.title },
            askedInMessageId: { S: pending.askedInMessageId },
            expiresAt: { N: String(Math.floor(Date.now() / 1000) + PENDING_DELETE_TTL_SECONDS) },
          },
        }),
      );
    },

    async clearPendingDelete(userId, conversationId) {
      await client.send(
        new DeleteItemCommand({
          TableName: tableName,
          Key: { pk: { S: pendingKey(userId, conversationId) } },
        }),
      );
    },
  };
}
