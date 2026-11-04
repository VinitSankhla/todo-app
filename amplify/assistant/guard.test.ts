// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isValidTimeZone } from './dates';
import {
  callerFromAuthorization,
  checkMessage,
  isAffirmative,
  timeZoneFromContext,
  type StoredMessage,
} from './guard';

const user = (id: string, text: string): StoredMessage => ({
  id,
  role: 'user',
  content: [{ text, image: null, document: null, toolUse: null, toolResult: null }],
});

describe('checkMessage', () => {
  it('accepts a normal message', () => {
    const message = user('m1', 'Add buy milk tomorrow');
    expect(checkMessage(message, [message])).toBeNull();
  });

  it('rejects messages over 500 characters', () => {
    const message = user('m1', 'x'.repeat(501));
    expect(checkMessage(message, [message])).toMatchObject({ errorType: 'MessageTooLong' });
    const atLimit = user('m1', 'x'.repeat(500));
    expect(checkMessage(atLimit, [atLimit])).toBeNull();
  });

  it('rejects empty messages', () => {
    const message = user('m1', '   ');
    expect(checkMessage(message, [message])).not.toBeNull();
  });

  it('rejects images, documents and tool blocks', () => {
    const image: StoredMessage = {
      id: 'm1',
      role: 'user',
      content: [{ text: null, image: { format: 'png' } }],
    };
    expect(checkMessage(image, [image])).toMatchObject({ errorType: 'UnsupportedContent' });
    const tool: StoredMessage = {
      id: 'm1',
      role: 'user',
      content: [{ text: 'hi' }, { toolResult: { toolUseId: 'x' } }],
    };
    expect(checkMessage(tool, [tool])).toMatchObject({ errorType: 'UnsupportedContent' });
  });

  it('asks for a new chat after 20 messages', () => {
    const history = Array.from({ length: 21 }, (_, i) => user(`m${i}`, 'hi'));
    expect(checkMessage(history[20], history)).toMatchObject({ errorType: 'ChatFull' });
    expect(checkMessage(history[19], history.slice(0, 20))).toBeNull();
  });
});

describe('isAffirmative', () => {
  it.each([
    'yes',
    'Yes!',
    'yes please',
    'Yeah, delete it',
    'ok',
    'Okay.',
    'sure',
    'confirm',
    'go ahead',
    'haan',
  ])('"%s" confirms', (text) => expect(isAffirmative(text)).toBe(true));

  it.each([
    'no',
    'nope',
    'yes but not that one',
    "don't",
    'wait',
    'cancel',
    'maybe',
    'which one',
    '',
    'delete all',
  ])('"%s" does not confirm', (text) => expect(isAffirmative(text)).toBe(false));
});

describe('timeZoneFromContext', () => {
  it('reads a valid time zone and falls back to UTC', () => {
    expect(timeZoneFromContext({ timeZone: 'Asia/Kolkata' }, isValidTimeZone)).toBe('Asia/Kolkata');
    expect(timeZoneFromContext('{"timeZone":"Europe/London"}', isValidTimeZone)).toBe(
      'Europe/London',
    );
    expect(timeZoneFromContext({ timeZone: 'Mars/Base' }, isValidTimeZone)).toBe('UTC');
    expect(timeZoneFromContext('not json', isValidTimeZone)).toBe('UTC');
    expect(timeZoneFromContext(undefined, isValidTimeZone)).toBe('UTC');
  });
});

describe('callerFromAuthorization', () => {
  const token = (claims: object) =>
    `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;

  it('reads the user id and username from an access or ID token', () => {
    expect(callerFromAuthorization(token({ sub: 's1', username: 'u1' }))).toEqual({
      sub: 's1',
      username: 'u1',
    });
    expect(
      callerFromAuthorization(`Bearer ${token({ sub: 's1', 'cognito:username': 'u1' })}`),
    ).toEqual({ sub: 's1', username: 'u1' });
  });

  it('rejects missing or incomplete tokens', () => {
    expect(() => callerFromAuthorization(undefined)).toThrow();
    expect(() => callerFromAuthorization(token({ sub: 's1' }))).toThrow();
  });
});
