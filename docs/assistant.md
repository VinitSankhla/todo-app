# AI Assistant

After login, the **Assistant** button on the tasks page opens a chat panel. You can type (or
speak, where the browser supports it) requests such as _"add pay rent due next Friday"_,
_"what is due tomorrow?"_, _"mark buy milk as done"_ or _"delete call bank"_. The assistant
also answers greetings and _"what can you do?"_, and politely declines anything else.

## How it works

```
Chat panel (React) ──▶ AppSync conversation route "assistant" (owner-only)
                          │  stores chats + messages in 2 DynamoDB tables (AI Kit)
                          ▼
                 assistant-handler Lambda (amplify/assistant/handler.ts)
                   1. checks: text only, ≤ 500 characters, ≤ 20 messages per chat
                   2. rate limits per user: 6 / minute, 60 / day   (AssistantState table)
                   3. adds today's date in the user's time zone to the system prompt
                   4. runs the model with 5 tools ──▶ Amazon Bedrock: Nova Lite
                          │                           (APAC cross-region inference profile)
                          ▼
           tools call the app's OWN API (listTasksByOwner, getTask, addTask, editTask,
           deleteTask) with the SIGNED-IN USER'S token  ──▶ same validation + owner rules
```

- **Amplify AI Kit** (`a.conversation` in `amplify/data/resource.ts`) provides the chat API,
  storage and streaming. Its authorization is `allow.owner()`: a user can only create, read
  and send messages to their own chats.
- **Tools** (`amplify/assistant/tools.ts`): `find_tasks`, `create_task`, `update_task`
  (rename, description, set/change/remove due date, done/undone), `request_delete`,
  `confirm_delete`. They have no database access of their own; they call the existing GraphQL
  API with the user's token, so another user's task looks exactly like a missing one.
- **Replies stream** to the browser over AppSync's real-time WebSocket. The browser hides the
  model's private `<thinking>` text and shows only the answer. After each reply the task list
  reloads, because the assistant may have changed tasks.

## Safety rules

| Rule                                    | Where it is enforced                                                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Only the user's own tasks and chats     | AppSync owner rules (tools use the user's token); covered by `npm run test:assistant-authz`                                                                                 |
| Same validation as the app              | `shared/task-validation.ts` in the tools, then the server resolvers                                                                                                         |
| Never guess which task                  | **Code:** a title that matches several tasks is refused, and the model must ask. Also in the system prompt.                                                                 |
| Ask before deleting                     | **Code:** `confirm_delete` only deletes the task named in the previous question, only if the user's very next message says yes (and not no/wait/cancel), one task at a time |
| Dates like "tomorrow" / "next Friday"   | **Code** (`dates.ts`), using today's date in the browser's time zone; the reply repeats the date                                                                            |
| Task text is data, never instructions   | Every tool result labels it; system prompt rule                                                                                                                             |
| Never reveal the system prompt          | System prompt rule; the prompt is stored server-side only (never sent to the browser)                                                                                       |
| Decline unrelated or risky requests     | System prompt rule                                                                                                                                                          |
| Limits on cost                          | **Code:** 500 characters, 6/min and 60/day per user, 20 messages per chat, 400-token replies, 8 tool calls and 30 s per message                                             |
| Rest of the app works when the AI fails | The panel loads only when opened and shows "The assistant is unavailable right now"; task pages never depend on it                                                          |

Date rule: _"Friday"_ / _"this Friday"_ = the soonest Friday, today included; _"next Friday"_
= the soonest Friday **after** today. Supported: today, tomorrow, day after tomorrow, weekday
names, in N days/weeks/months, next week/month, "5 Nov", "November 5 2027", YYYY-MM-DD.

## Voice

- **Speak** (Chrome, Edge, Safari): the browser's speech recognition writes what you said into
  the message box. You check it and press **Send**; it is never sent automatically.
- **Read replies aloud**: the browser's speech synthesis reads each finished answer. Off by
  default; the choice is remembered in this browser only.
- Where a browser cannot listen (e.g. Firefox) the button is hidden and the panel says to type.
  Microphone errors (blocked, missing, no speech) show a message suggesting typing instead.
- **Privacy:** in Chrome, speech recognition sends your audio to Google to turn it into text.
- The site's `Permissions-Policy` header allows the microphone for this site only
  (`customHttp.yml`).

## Model

Amazon **Nova Lite** through the **APAC cross-region inference profile**
(`apac.amazon.nova-lite-v1:0`), because Mumbai offers it only that way. Requests may be
processed in another Asia-Pacific AWS region; tasks themselves stay in Mumbai. No model-access
form is needed for Nova. The Lambda's IAM policy allows only this profile
(`amplify/backend.ts`). To change model, edit `amplify/assistant/resource.ts` and the policy.

## New AWS resources and cost risk

| Resource                                                         | Cost risk                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Bedrock model calls (Nova Lite)**                              | **The only real cost.** ≈ $0.06–0.07 per million input tokens, ≈ $0.24–0.28 per million output tokens (verify on the Bedrock pricing page). ≈ $0.0005–0.002 per message. Capped by the limits above: at most ~60 messages per user per day. |
| 2 DynamoDB tables: chats and messages (created by AI Kit)        | On-demand; tiny. Chats are kept until deleted.                                                                                                                                                                                              |
| 1 DynamoDB table `AssistantState` (rate limits, pending deletes) | On-demand; every item expires by itself (TTL). Practically $0.                                                                                                                                                                              |
| 1 Lambda `assistant-handler` (256 MB, 30 s max)                  | Free tier covers it (1 million runs/month).                                                                                                                                                                                                 |
| CloudWatch log group for the Lambda (kept 1 month)               | Small; within the 5 GB/month free tier.                                                                                                                                                                                                     |
| IAM role for the Lambda                                          | Free.                                                                                                                                                                                                                                       |
| AppSync conversation resolvers + real-time connection            | Requests ≈ $4 per million; real-time ≈ $2 per million messages + $0.08 per million connection-minutes. Tiny.                                                                                                                                |

**Keep the $1/month AWS Budget alert** (Billing → Budgets). It is the safety net if a limit
ever fails. Worst case per active user per month with the 60/day cap: roughly $1.

## Testing

```bash
npm test                       # all unit tests (no AWS, no AI cost)
npx vitest run amplify/assistant src/test/assistant.test.tsx src/test/voice.test.tsx
npm run test:assistant-authz   # SANDBOX ONLY, ~5 AI calls (< 1 US cent)
```

Unit tests cover each tool, date handling and time zones, delete confirmation (yes / no /
wait / not the next message / one at a time), title matching (never guessing), cross-user
access through the tools, message and rate limits, the handler checks, hiding `<thinking>`,
error messages, the chat panel, voice input and spoken replies.

`integration/assistant-authz.test.ts` uses the same two sandbox users as `npm run test:authz`
(see the README) and proves user B cannot open, list, read or write into user A's chat, and
that B's assistant cannot reveal, rename or delete A's task (checked afterwards as A).

## Known limits

- **Deleting when several tasks have similar names can still fail** in practice (reported in
  sandbox testing, not yet solved). The safety checks refuse rather than delete the wrong
  task, so the worst outcome is that nothing is deleted. Use the Delete button instead.
- Renaming was reported not working before the title-matching fix and has not been
  re-verified since. Check the task list after asking.
- Nova Lite is a small model: it can misunderstand, ignore a rule, or say something worked
  when it did not. Every action is shown in the task list, which refreshes after each reply.
  Always check it.
- The model only remembers the **text** of the chat between messages, not task ids, so it has
  to look tasks up again each time.
- Prompt-injection protection (task text labelled as data) reduces the risk but cannot fully
  guarantee that a model never follows text written inside a task.
- Chats are stored on the server (DynamoDB) and are not deleted automatically. The panel does
  not reload an old chat after a page refresh; **New chat** starts a fresh one.
- Rate limits use fixed windows: the minute limit resets at each clock minute, the daily limit
  at midnight UTC.
- Replies are capped at about 300 words, so a very long task list may be cut short.
- Up to 500 tasks are read per message, and at most 20 are listed in one reply.
- Voice input language is the browser's language. Firefox has no voice input. Chrome sends audio
  to Google.
- The developer AWS login (`vinit-dev`) cannot read the Lambda's logs; use the root or an
  admin login in CloudWatch → Log groups to debug.
- Like the rest of the app, the assistant has automated tests but is **not guaranteed bug-free**.
