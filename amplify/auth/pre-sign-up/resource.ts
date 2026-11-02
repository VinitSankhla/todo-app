import { defineFunction } from '@aws-amplify/backend';

export const preSignUp = defineFunction({
  name: 'pre-sign-up',
  // Deploy alongside the auth resources (avoids a circular dependency between stacks).
  resourceGroupName: 'auth',
  timeoutSeconds: 5,
  memoryMB: 128,
});
