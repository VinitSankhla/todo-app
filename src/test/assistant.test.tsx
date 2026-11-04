import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '../auth/auth-context';
import {
  assistantErrorMessage,
  startAssistantChat,
  visibleReply,
  type AssistantHandlers,
} from '../lib/assistant-api';
import { listTasks, type Task } from '../lib/task-api';
import TasksPage from '../pages/TasksPage';

vi.mock('../lib/task-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/task-api')>()),
  listTasks: vi.fn(),
}));

vi.mock('../lib/assistant-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/assistant-api')>()),
  startAssistantChat: vi.fn(),
}));

const OWNER = 'sub-1::user-1';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    title: 'Buy milk',
    description: null,
    dueDate: null,
    done: false,
    owner: OWNER,
    createdAt: '2026-11-01T10:00:00.000Z',
    updatedAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  } as Task;
}

let handlers: AssistantHandlers;
const send = vi.fn<(text: string) => Promise<string>>();
const close = vi.fn();

beforeEach(() => {
  vi.mocked(listTasks).mockResolvedValue([makeTask()]);
  send.mockResolvedValue('msg-1');
  vi.mocked(startAssistantChat).mockImplementation(async (h) => {
    handlers = h;
    return { send, close };
  });
});

function renderTasks() {
  const auth: AuthContextValue = {
    state: {
      status: 'signedIn',
      user: { userId: 'sub-1', ownerKey: OWNER, email: 'vinit@gmail.com', name: 'Vinit' },
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
  return user;
}

async function openAssistant() {
  const user = renderTasks();
  await screen.findByText('Buy milk');
  await user.click(screen.getByRole('button', { name: 'Assistant' }));
  const panel = await screen.findByRole('dialog', { name: 'Assistant' });
  await within(panel).findByText(/Try:/);
  return { user, panel: within(panel) };
}

const messageBox = () => screen.getByRole('textbox', { name: 'Message the assistant' });

describe('assistant panel', () => {
  it('shows an Assistant button on the tasks page and opens the chat', async () => {
    const { panel } = await openAssistant();
    expect(panel.getByText(/always ask before deleting/)).toBeInTheDocument();
    expect(messageBox()).toHaveFocus();
  });

  it('sends a message, shows the streamed reply and refreshes the task list', async () => {
    const { user, panel } = await openAssistant();
    expect(listTasks).toHaveBeenCalledTimes(1);

    await user.type(messageBox(), 'Add buy eggs tomorrow{Enter}');
    expect(send).toHaveBeenCalledWith('Add buy eggs tomorrow');
    expect(panel.getByText('Add buy eggs tomorrow')).toBeInTheDocument();
    expect(messageBox()).toHaveValue('');

    vi.mocked(listTasks).mockResolvedValue([makeTask(), makeTask({ id: 't2', title: 'Buy eggs' })]);
    act(() => {
      handlers.onText('msg-1', 0, 1, 'due Friday, 6 November 2026.');
      handlers.onText('msg-1', 0, 0, 'Added "Buy eggs", ');
    });
    expect(panel.getByText('Added "Buy eggs", due Friday, 6 November 2026.')).toBeInTheDocument();

    act(() => handlers.onDone('msg-1'));
    expect(await screen.findByText('Buy eggs')).toBeInTheDocument();
    expect(listTasks).toHaveBeenCalledTimes(2);
  });

  it('shows a reply that started arriving before the message id was known', async () => {
    let resolveSend: (id: string) => void = () => undefined;
    send.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    const { user, panel } = await openAssistant();
    await user.type(messageBox(), 'hi{Enter}');
    act(() => handlers.onText('msg-1', 0, 0, 'Hello! How can I help?'));
    await act(async () => resolveSend('msg-1'));
    expect(panel.getByText('Hello! How can I help?')).toBeInTheDocument();
  });

  it('shows a clear message when a reply fails, and keeps the task list working', async () => {
    const { user, panel } = await openAssistant();
    await user.type(messageBox(), 'hello{Enter}');
    act(() =>
      handlers.onError(
        'msg-1',
        assistantErrorMessage([{ errorType: 'RateLimited', message: 'Please wait a moment.' }]),
      ),
    );
    expect(panel.getByRole('alert')).toHaveTextContent('Please wait a moment.');
    expect(screen.getByText('Buy milk')).toBeInTheDocument();
  });

  it("hides the model's private <thinking> text, even while it streams in", async () => {
    expect(visibleReply('<thinking>find it</thinking> Done!')).toBe('Done!');
    expect(visibleReply('<thinking>a</thinking>\n\n<thinking>b</thinking>\nWhich one?')).toBe(
      'Which one?',
    );
    expect(visibleReply('<thinking>still thinking')).toBe('');
    expect(visibleReply('<think')).toBe('');
    expect(visibleReply('Use a < b')).toBe('Use a < b');

    const { user, panel } = await openAssistant();
    await user.type(messageBox(), 'hi{Enter}');
    act(() => handlers.onText('msg-1', 0, 0, '<thinking>The user greets me.</thinking> Hello!'));
    expect(panel.getByText('Hello!')).toBeInTheDocument();
    expect(panel.queryByText(/The user greets me/)).not.toBeInTheDocument();
  });

  it('never shows raw technical errors', () => {
    expect(
      assistantErrorMessage([{ errorType: 'AccessDeniedException', message: 'arn:aws:iam::123…' }]),
    ).toMatch(/assistant is unavailable/);
  });

  it('shows "unavailable" when the assistant cannot start; the rest of the app still works', async () => {
    vi.mocked(startAssistantChat).mockRejectedValue(new Error('network'));
    const user = renderTasks();
    await screen.findByText('Buy milk');
    await user.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/assistant is unavailable/);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeEnabled();
  });

  it('limits messages to 500 characters', async () => {
    const { user, panel } = await openAssistant();
    await user.click(messageBox());
    await user.paste('x'.repeat(501));
    expect(panel.getByText(/501\/500/)).toBeInTheDocument();
    expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(send).not.toHaveBeenCalled();
  });

  it('only sends one message at a time', async () => {
    const { user, panel } = await openAssistant();
    await user.type(messageBox(), 'first{Enter}');
    await user.type(messageBox(), 'second');
    expect(panel.getByRole('button', { name: 'Send' })).toBeDisabled();
    act(() => handlers.onDone('msg-1'));
    await waitFor(() => expect(panel.getByRole('button', { name: 'Send' })).toBeEnabled());
  });

  it('closes with Escape and the close button, and returns focus to the Assistant button', async () => {
    const { user } = await openAssistant();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assistant' })).toHaveFocus();
    expect(close).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Assistant' }));
    await screen.findByRole('dialog', { name: 'Assistant' });
    await user.click(screen.getByRole('button', { name: 'Close assistant' }));
    expect(screen.queryByRole('dialog', { name: 'Assistant' })).not.toBeInTheDocument();
  });

  it('starts a new chat', async () => {
    const { user, panel } = await openAssistant();
    await user.type(messageBox(), 'hello{Enter}');
    act(() => handlers.onDone('msg-1'));
    await user.click(panel.getByRole('button', { name: 'New chat' }));
    await panel.findByText(/Try:/);
    expect(panel.queryByText('hello')).not.toBeInTheDocument();
    expect(startAssistantChat).toHaveBeenCalledTimes(2);
  });
});
