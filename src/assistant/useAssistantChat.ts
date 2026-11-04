import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSISTANT_MAX_MESSAGE_LENGTH } from '../../shared/assistant-limits';
import {
  ASSISTANT_UNAVAILABLE,
  startAssistantChat,
  visibleReply,
  type AssistantChat,
} from '../lib/assistant-api';

/** One exchange: the user's message and the assistant's reply to it. */
export interface ChatTurn {
  key: number;
  userText: string;
  /** The assistant's reply so far. */
  reply: string;
  status: 'sending' | 'replying' | 'done' | 'error';
  error?: string;
}

export type ChatStatus = 'starting' | 'ready' | 'unavailable';

/** How long to wait for a reply before giving up. */
const REPLY_TIMEOUT_MS = 60_000;

interface ReplyBuffer {
  /** Text pieces by content block, then by position within the block (they can arrive out of order). */
  blocks: string[][];
}

function joinReply(buffer: ReplyBuffer): string {
  return buffer.blocks
    .map((pieces) => visibleReply(pieces.join('')))
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Chat state for the assistant panel. `onTasksChanged` runs after every finished reply,
 * because the assistant may have created, changed or deleted tasks.
 */
export function useAssistantChat(onTasksChanged: () => void) {
  const [status, setStatus] = useState<ChatStatus>('starting');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [chatVersion, setChatVersion] = useState(0);
  const chatRef = useRef<AssistantChat | null>(null);
  // Which turn each server message id belongs to, and the reply text received so far.
  const turnByMessageId = useRef(new Map<string, number>());
  const buffers = useRef(new Map<string, ReplyBuffer>());
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextKey = useRef(1);
  const onTasksChangedRef = useRef(onTasksChanged);
  useEffect(() => {
    onTasksChangedRef.current = onTasksChanged;
  });

  const updateTurn = useCallback((key: number, change: Partial<ChatTurn>) => {
    setTurns((current) =>
      current.map((turn) => (turn.key === key ? { ...turn, ...change } : turn)),
    );
  }, []);

  const finishTurn = useCallback(
    (key: number, change: Partial<ChatTurn>) => {
      clearTimeout(timers.current.get(key));
      timers.current.delete(key);
      updateTurn(key, change);
    },
    [updateTurn],
  );

  useEffect(() => {
    let cancelled = false;
    const turnMap = turnByMessageId.current;
    const replyBuffers = buffers.current;
    const turnTimers = timers.current;

    startAssistantChat({
      onText(messageId, blockIndex, deltaIndex, text) {
        const buffer = replyBuffers.get(messageId) ?? { blocks: [] };
        (buffer.blocks[blockIndex] ??= [])[deltaIndex] = text;
        replyBuffers.set(messageId, buffer);
        const key = turnMap.get(messageId);
        if (key !== undefined) updateTurn(key, { reply: joinReply(buffer), status: 'replying' });
      },
      onDone(messageId) {
        const key = turnMap.get(messageId);
        const buffer = replyBuffers.get(messageId);
        if (key !== undefined) {
          finishTurn(key, { reply: buffer ? joinReply(buffer) : '', status: 'done' });
        }
        onTasksChangedRef.current();
      },
      onError(messageId, message) {
        const key = messageId ? turnMap.get(messageId) : undefined;
        if (key !== undefined) finishTurn(key, { status: 'error', error: message });
        // The assistant may have changed a task before failing.
        onTasksChangedRef.current();
      },
    }).then(
      (chat) => {
        if (cancelled) return chat.close();
        chatRef.current = chat;
        setStatus('ready');
      },
      () => {
        if (!cancelled) setStatus('unavailable');
      },
    );

    return () => {
      cancelled = true;
      chatRef.current?.close();
      chatRef.current = null;
      turnMap.clear();
      replyBuffers.clear();
      turnTimers.forEach(clearTimeout);
      turnTimers.clear();
    };
  }, [chatVersion, finishTurn, updateTurn]);

  const busy = turns.some((turn) => turn.status === 'sending' || turn.status === 'replying');

  const send = useCallback(
    async (rawText: string): Promise<boolean> => {
      const text = rawText.trim();
      const chat = chatRef.current;
      if (!chat || busy || !text || text.length > ASSISTANT_MAX_MESSAGE_LENGTH) return false;
      const key = nextKey.current++;
      setTurns((current) => [...current, { key, userText: text, reply: '', status: 'sending' }]);
      timers.current.set(
        key,
        setTimeout(() => {
          updateTurn(key, {
            status: 'error',
            error: 'No reply from the assistant. Please try again.',
          });
          timers.current.delete(key);
        }, REPLY_TIMEOUT_MS),
      );
      try {
        const messageId = await chat.send(text);
        turnByMessageId.current.set(messageId, key);
        // The reply may have started arriving before we learned the message id.
        const buffer = buffers.current.get(messageId);
        if (buffer) updateTurn(key, { reply: joinReply(buffer), status: 'replying' });
        return true;
      } catch {
        finishTurn(key, { status: 'error', error: ASSISTANT_UNAVAILABLE });
        return false;
      }
    },
    [busy, finishTurn, updateTurn],
  );

  /** Starts a fresh chat (the previous one stays stored on the server but is not shown). */
  const newChat = useCallback(() => {
    setTurns([]);
    setStatus('starting');
    setChatVersion((version) => version + 1);
  }, []);

  return { status, turns, busy, send, newChat };
}
