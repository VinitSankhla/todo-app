import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
});

// Explicit password policy, enforced by Cognito itself (not only by the signup form).
const { cfnUserPool } = backend.auth.resources.cfnResources;
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSymbols: true,
    temporaryPasswordValidityDays: 3,
  },
};
