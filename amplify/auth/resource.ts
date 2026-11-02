import { defineAuth } from '@aws-amplify/backend';
import { preSignUp } from './pre-sign-up/resource';

/**
 * Cognito user pool: email is the username (unique, case-insensitive) and must be verified
 * with a code. Name and gender are required at signup; date of birth is optional.
 * @see https://docs.amplify.aws/react/build-a-backend/auth/
 */
export const auth = defineAuth({
  loginWith: {
    email: {
      verificationEmailStyle: 'CODE',
      verificationEmailSubject: 'Your To-Do App verification code',
      verificationEmailBody: (createCode) =>
        `Your To-Do App verification code is ${createCode()}. It expires in 24 hours.`,
    },
  },
  userAttributes: {
    fullname: { required: true, mutable: true },
    gender: { required: true, mutable: true },
    birthdate: { required: false, mutable: true },
  },
  accountRecovery: 'EMAIL_ONLY',
  triggers: {
    preSignUp,
  },
});
