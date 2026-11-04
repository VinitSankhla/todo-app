import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ASSISTANT_MAX_MESSAGE_LENGTH } from '../../shared/assistant-limits';
import { Alert, Button, Spinner } from '../components/ui';
import { ASSISTANT_UNAVAILABLE } from '../lib/assistant-api';
import { canSpeak, loadSpeakReplies, saveSpeakReplies, speak, stopSpeaking } from './speech';
import { useAssistantChat, type ChatTurn } from './useAssistantChat';
import { useVoiceInput } from './useVoiceInput';

interface AssistantPanelProps {
  onClose: () => void;
  /** Called after each assistant reply, so the task list can refresh. */
  onTasksChanged: () => void;
}

const EXAMPLES = [
  'Add "Pay electricity bill" due next Friday',
  'What tasks are due tomorrow?',
  'Mark "Buy milk" as done',
];

/**
 * The assistant chat panel. A side panel on large screens, full screen on phones.
 * Escape or the close button closes it; the rest of the page keeps working while it is open.
 */
export default function AssistantPanel({ onClose, onTasksChanged }: AssistantPanelProps) {
  const { status, turns, busy, send, newChat } = useAssistantChat(onTasksChanged);
  const [draft, setDraft] = useState('');
  const voice = useVoiceInput(setDraft);
  const [speechAvailable] = useState(canSpeak);
  const [speakReplies, setSpeakReplies] = useState(() => speechAvailable && loadSpeakReplies());
  const spokenTurn = useRef(0);
  const titleId = useId();
  const voiceHelpId = useId();
  const inputId = useId();
  const counterId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const latestOnClose = useRef(onClose);
  useEffect(() => {
    latestOnClose.current = onClose;
  });

  // Focus the message box on open; Escape closes the panel; focus returns to the opener on close.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // The message box is disabled while connecting, so focus the panel itself first.
    panelRef.current?.focus();
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      // Only when focus is in the panel, so Escape in a task dialog does not also close the chat.
      if (event.key === 'Escape' && panelRef.current?.contains(document.activeElement)) {
        latestOnClose.current();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      stopSpeaking();
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    if (status === 'ready') inputRef.current?.focus();
  }, [status]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const length = draft.trim().length;
  const tooLong = length > ASSISTANT_MAX_MESSAGE_LENGTH;
  const canSend = status === 'ready' && !busy && length > 0 && !tooLong;

  // Read each finished reply aloud once, when the user has switched that on.
  useEffect(() => {
    const latest = turns.at(-1);
    if (!latest || latest.key === spokenTurn.current) return;
    if (latest.status !== 'done' && latest.status !== 'error') return;
    spokenTurn.current = latest.key;
    if (speakReplies) speak(latest.status === 'error' ? (latest.error ?? '') : latest.reply);
  }, [turns, speakReplies]);

  function toggleSpeakReplies(value: boolean) {
    setSpeakReplies(value);
    saveSpeakReplies(value);
    if (!value) stopSpeaking();
  }

  async function submit() {
    if (!canSend) return;
    voice.stop();
    stopSpeaking();
    const text = draft;
    setDraft('');
    const sent = await send(text);
    if (!sent) setDraft(text);
    inputRef.current?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a new line.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const lastDone = [...turns]
    .reverse()
    .find((turn) => turn.status === 'done' || turn.status === 'error');

  return (
    <section
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className="fixed inset-0 z-40 flex flex-col bg-white focus:outline-none shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-96 sm:border-l sm:border-slate-200"
    >
      <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          Assistant
        </h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={newChat} disabled={status === 'starting' || busy}>
            New chat
          </Button>
          <Button variant="secondary" onClick={onClose} aria-label="Close assistant">
            <span aria-hidden="true">X</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {status === 'starting' && (
          <div className="py-6 text-center text-slate-600">
            <Spinner label="Connecting to the assistant..." />
          </div>
        )}

        {status === 'unavailable' && (
          <div className="space-y-3">
            <Alert kind="error">{ASSISTANT_UNAVAILABLE}</Alert>
            <Button variant="secondary" onClick={newChat}>
              Try again
            </Button>
          </div>
        )}

        {status === 'ready' && turns.length === 0 && (
          <div className="space-y-2 text-sm text-slate-600">
            <p>
              Hi! I can add, find, change, complete and delete your tasks. I always ask before
              deleting anything.
            </p>
            <p>Try:</p>
            <ul className="list-disc space-y-1 pl-5">
              {EXAMPLES.map((example) => (
                <li key={example}>{example}</li>
              ))}
            </ul>
          </div>
        )}

        {turns.length > 0 && (
          <ol aria-label="Conversation" className="space-y-4">
            {turns.map((turn) => (
              <Turn key={turn.key} turn={turn} />
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      {/* Screen readers hear each finished reply once, not every streamed word. */}
      <p role="status" className="sr-only">
        {lastDone ? (lastDone.status === 'error' ? lastDone.error : lastDone.reply) : ''}
      </p>

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-slate-200 px-4 py-3">
        <label htmlFor={inputId} className="sr-only">
          Message the assistant
        </label>
        <textarea
          id={inputId}
          ref={inputRef}
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          disabled={status !== 'ready'}
          placeholder={voice.listening ? 'Listening...' : 'Type a message... (Enter to send)'}
          aria-describedby={`${counterId} ${voiceHelpId}`}
          aria-invalid={tooLong || undefined}
          className="block w-full resize-none rounded-md border border-slate-300 px-3 py-2 text-slate-900 shadow-sm placeholder:text-slate-400 disabled:bg-slate-100 aria-[invalid=true]:border-red-600"
        />
        {voice.error && <Alert kind="error">{voice.error}</Alert>}
        <div className="flex items-center justify-between gap-2">
          <p id={counterId} className={`text-xs ${tooLong ? 'text-red-700' : 'text-slate-500'}`}>
            {length}/{ASSISTANT_MAX_MESSAGE_LENGTH}
            {tooLong && ' - message is too long'}
          </p>
          <div className="flex gap-2">
            {voice.supported && (
              <Button
                variant="secondary"
                onClick={voice.listening ? voice.stop : voice.start}
                disabled={status !== 'ready' || busy}
              >
                {voice.listening ? 'Stop listening' : 'Speak'}
              </Button>
            )}
            <Button type="submit" disabled={!canSend} loading={busy}>
              Send
            </Button>
          </div>
        </div>
        <div id={voiceHelpId} className="space-y-1 text-xs text-slate-500">
          {voice.listening && (
            <p role="status" className="font-medium text-indigo-700">
              Listening... speak now, then check the text and press Send.
            </p>
          )}
          {!voice.supported && (
            <p>Voice input is not available in this browser. Please type your message.</p>
          )}
        </div>
        {speechAvailable && (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={speakReplies}
              onChange={(event) => toggleSpeakReplies(event.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Read replies aloud
          </label>
        )}
      </form>
    </section>
  );
}

function Turn({ turn }: { turn: ChatTurn }) {
  return (
    <li className="space-y-2">
      <div className="ml-8 whitespace-pre-wrap break-words rounded-lg bg-indigo-600 px-3 py-2 text-sm text-white">
        <span className="sr-only">You: </span>
        {turn.userText}
      </div>
      {turn.status === 'error' ? (
        <Alert kind="error">{turn.error}</Alert>
      ) : (
        <div className="mr-8 whitespace-pre-wrap break-words rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-900">
          <span className="sr-only">Assistant: </span>
          {turn.reply || (turn.status === 'done' ? '(no reply)' : <Spinner label="Thinking..." />)}
        </div>
      )}
    </li>
  );
}
