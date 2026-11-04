import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Recognizer } from '../assistant/speech';
import { recognitionErrorMessage } from '../assistant/speech';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import { startAssistantChat, type AssistantHandlers } from '../lib/assistant-api';
import { listTasks } from '../lib/task-api';
import TasksPage from '../pages/TasksPage';

vi.mock('../lib/task-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/task-api')>()),
  listTasks: vi.fn(),
}));

vi.mock('../lib/assistant-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/assistant-api')>()),
  startAssistantChat: vi.fn(),
}));

/** A stand-in for the browser's SpeechRecognition. */
class FakeRecognizer implements Recognizer {
  static last: FakeRecognizer | null = null;
  lang = '';
  interimResults = false;
  continuous = false;
  onresult: Recognizer['onresult'] = null;
  onerror: Recognizer['onerror'] = null;
  onend: Recognizer['onend'] = null;
  start = vi.fn();
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() {
    FakeRecognizer.last = this;
  }
  hear(...pieces: string[]) {
    this.onresult?.({
      resultIndex: 0,
      results: pieces.map((transcript) => ({ isFinal: true, 0: { transcript } })),
    });
  }
}

let handlers: AssistantHandlers;
const send = vi.fn<(text: string) => Promise<string>>();
const speakSpy = vi.fn();
const cancelSpy = vi.fn();
const speechWindow = window as unknown as Record<string, unknown>;

function enableRecognition() {
  speechWindow.webkitSpeechRecognition = FakeRecognizer;
}

function enableSynthesis() {
  speechWindow.speechSynthesis = { speak: speakSpy, cancel: cancelSpy };
  speechWindow.SpeechSynthesisUtterance = class {
    lang = '';
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  };
}

beforeEach(() => {
  FakeRecognizer.last = null;
  window.localStorage.clear();
  vi.mocked(listTasks).mockResolvedValue([]);
  send.mockResolvedValue('msg-1');
  vi.mocked(startAssistantChat).mockImplementation(async (h) => {
    handlers = h;
    return { send, close: vi.fn() };
  });
});

afterEach(() => {
  delete speechWindow.webkitSpeechRecognition;
  delete speechWindow.speechSynthesis;
  delete speechWindow.SpeechSynthesisUtterance;
});

async function openAssistant() {
  const auth: AuthContextValue = {
    state: {
      status: 'signedIn',
      user: { userId: 'sub-1', ownerKey: 'sub-1::u', email: 'vinit@gmail.com', name: 'Vinit' },
    },
    refresh: vi.fn(),
    logout: vi.fn(),
  };
  const user = userEvent.setup();
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter>
        <TasksPage />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
  await user.click(await screen.findByRole('button', { name: 'Assistant' }));
  const panel = within(await screen.findByRole('dialog', { name: 'Assistant' }));
  await panel.findByText(/Try:/);
  return { user, panel };
}

const messageBox = () => screen.getByRole('textbox', { name: 'Message the assistant' });

describe('voice input', () => {
  it('falls back to typing when the browser cannot listen', async () => {
    const { panel } = await openAssistant();
    expect(panel.queryByRole('button', { name: 'Speak' })).not.toBeInTheDocument();
    expect(panel.getByText(/Voice input is not available in this browser/)).toBeInTheDocument();
    expect(messageBox()).toBeEnabled();
  });

  it('puts what was heard in the message box, without sending it', async () => {
    enableRecognition();
    const { user, panel } = await openAssistant();
    await user.click(panel.getByRole('button', { name: 'Speak' }));
    const recognizer = FakeRecognizer.last!;
    expect(recognizer.start).toHaveBeenCalled();
    expect(panel.getByText(/Listening\.\.\. speak now/)).toBeInTheDocument();

    act(() => recognizer.hear('add buy milk', ' tomorrow'));
    expect(messageBox()).toHaveValue('add buy milk tomorrow');
    expect(send).not.toHaveBeenCalled();

    await user.click(panel.getByRole('button', { name: 'Stop listening' }));
    expect(panel.getByRole('button', { name: 'Speak' })).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: 'Send' }));
    expect(send).toHaveBeenCalledWith('add buy milk tomorrow');
  });

  it('explains microphone errors and suggests typing', async () => {
    enableRecognition();
    const { user, panel } = await openAssistant();
    await user.click(panel.getByRole('button', { name: 'Speak' }));
    act(() => {
      FakeRecognizer.last!.onerror?.({ error: 'not-allowed' });
      FakeRecognizer.last!.onend?.();
    });
    expect(panel.getByRole('alert')).toHaveTextContent(/Microphone access is blocked/);
    expect(panel.getByRole('button', { name: 'Speak' })).toBeEnabled();
  });

  it('has a message for every kind of recognition error', () => {
    for (const code of ['no-speech', 'audio-capture', 'network', 'something-else']) {
      expect(recognitionErrorMessage(code)).toMatch(/type/);
    }
  });
});

describe('spoken replies', () => {
  it('reads finished replies aloud only when switched on, and remembers the choice', async () => {
    enableSynthesis();
    const { user, panel } = await openAssistant();
    const toggle = panel.getByRole('checkbox', { name: 'Read replies aloud' });
    expect(toggle).not.toBeChecked();

    await user.type(messageBox(), 'hi{Enter}');
    act(() => {
      handlers.onText('msg-1', 0, 0, 'Hello!');
      handlers.onDone('msg-1');
    });
    expect(speakSpy).not.toHaveBeenCalled();

    await user.click(toggle);
    expect(window.localStorage.getItem('assistant.speakReplies')).toBe('true');
    send.mockResolvedValue('msg-2');
    await user.type(messageBox(), 'what can you do?{Enter}');
    act(() => {
      handlers.onText('msg-2', 0, 0, '<thinking>hidden</thinking> I can manage your tasks.');
      handlers.onDone('msg-2');
    });
    expect(speakSpy).toHaveBeenCalledTimes(1);
    expect(speakSpy.mock.calls[0][0].text).toBe('I can manage your tasks.');
  });

  it('hides the option when the browser cannot speak', async () => {
    const { panel } = await openAssistant();
    expect(panel.queryByRole('checkbox', { name: 'Read replies aloud' })).not.toBeInTheDocument();
  });
});
