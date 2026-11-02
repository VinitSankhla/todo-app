// @vitest-environment node
import type { Context, PreSignUpTriggerEvent } from 'aws-lambda';
import { describe, expect, it } from 'vitest';
import { handler } from './handler';

function makeEvent(userAttributes: Record<string, string>): PreSignUpTriggerEvent {
  return {
    version: '1',
    region: 'ap-south-1',
    userPoolId: 'ap-south-1_test',
    userName: 'test-user',
    triggerSource: 'PreSignUp_SignUp',
    callerContext: { awsSdkVersion: '1', clientId: 'client' },
    request: { userAttributes },
    response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
  };
}

function run(attributes: Record<string, string>) {
  return handler(makeEvent(attributes), {} as Context, () => undefined);
}

const valid = { email: 'vinit@gmail.com', name: 'Vinit', gender: 'Male' };

describe('pre-sign-up trigger', () => {
  it('allows a valid Gmail signup and does not auto-confirm it', async () => {
    const result = await run(valid);
    expect(result).toMatchObject({ response: { autoConfirmUser: false, autoVerifyEmail: false } });
  });

  it('allows an optional valid birthdate', async () => {
    await expect(run({ ...valid, birthdate: '2000-05-17' })).resolves.toBeDefined();
  });

  it.each([
    [{ ...valid, email: 'vinit@yahoo.com' }, 'Only @gmail.com addresses are allowed.'],
    [{ ...valid, email: 'vinit+x@gmail.com' }, 'Gmail addresses containing "+" are not allowed.'],
    [{ ...valid, email: '' }, 'Email is required.'],
    [{ ...valid, name: '' }, 'Name is required.'],
    [{ ...valid, gender: 'unknown' }, 'Please select a valid gender option.'],
    [{ ...valid, birthdate: '2999-01-01' }, 'Date of birth cannot be in the future.'],
  ])('rejects %j', async (attributes, message) => {
    await expect(run(attributes)).rejects.toThrow(message);
  });
});
