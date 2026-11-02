import type { PreSignUpTriggerHandler } from 'aws-lambda';
import {
  validateBirthdate,
  validateEmail,
  validateGender,
  validateName,
} from '../../../shared/validation';

/**
 * Server-side signup validation. Cognito calls this before creating any user, so these rules
 * apply even if someone bypasses the web app and calls the Cognito API directly.
 * Throwing rejects the signup; Cognito returns "PreSignUp failed with error <message>".
 * (The password policy is enforced by Cognito itself — see amplify/backend.ts.)
 */
export const handler: PreSignUpTriggerHandler = async (event) => {
  const attributes = event.request.userAttributes;

  const error =
    validateEmail(attributes.email ?? '') ??
    validateName(attributes.name ?? '') ??
    validateGender(attributes.gender ?? '') ??
    validateBirthdate(attributes.birthdate);

  if (error) {
    throw new Error(error);
  }

  return event;
};
