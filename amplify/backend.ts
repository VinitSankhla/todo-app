import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
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

// Record which environment amplify_outputs.json belongs to. Amplify Hosting sets AWS_BRANCH
// during branch deploys; `ampx sandbox` does not. The sandbox-only authorization test
// (npm run test:authz) refuses to run unless this says "sandbox".
backend.addOutput({
  custom: { environment: process.env.AWS_BRANCH ?? 'sandbox' },
});
