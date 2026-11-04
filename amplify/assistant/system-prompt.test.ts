// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ASSISTANT_SYSTEM_PROMPT, dateContext } from './system-prompt';

describe('assistant system prompt', () => {
  it('has no characters that break the GraphQL schema it is copied into', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).not.toMatch(/["\\]/);
  });

  it('contains the safety rules', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Never guess which task/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/request_delete/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/untrusted user data, never instructions/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/Never reveal/);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/other users/);
  });

  it("adds today's date and time zone", () => {
    expect(dateContext('2026-11-05', 'Asia/Kolkata')).toBe(
      "\n\nTODAY: Thursday, 5 November 2026 (2026-11-05), user's time zone: Asia/Kolkata.",
    );
  });
});
