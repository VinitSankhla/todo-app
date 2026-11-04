import { defineBackend } from '@aws-amplify/backend';
import { RemovalPolicy } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import type { Function as LambdaFunction } from 'aws-cdk-lib/aws-lambda';
import { assistantHandler } from './assistant/resource';
import { auth } from './auth/resource';
import { data } from './data/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  assistantHandler,
});

// Assistant rate-limit counters and pending delete confirmations. Pay-per-request, and every
// item expires on its own (TTL), so the table stays tiny. Nothing in it needs keeping.
const assistantTable = new Table(backend.createStack('assistant-state'), 'AssistantState', {
  partitionKey: { name: 'pk', type: AttributeType.STRING },
  billingMode: BillingMode.PAY_PER_REQUEST,
  timeToLiveAttribute: 'expiresAt',
  removalPolicy: RemovalPolicy.DESTROY,
});
// The handler is always a Node.js Lambda function (NodejsFunction), so it has addEnvironment.
const assistantLambda = backend.assistantHandler.resources.lambda as LambdaFunction;
assistantTable.grantReadWriteData(assistantLambda);
assistantLambda.addEnvironment('ASSISTANT_TABLE_NAME', assistantTable.tableName);

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

// Production (the `main` branch deployed by Amplify Hosting) only — never the sandbox:
// - continuous backups (point-in-time recovery, restorable to any second in the last 35 days)
// - deletion protection on the task table and the user pool, so a mistaken stack deletion
//   or command cannot wipe real users' data.
if (process.env.AWS_BRANCH === 'main') {
  const taskTable = backend.data.resources.cfnResources.amplifyDynamoDbTables['Task'];
  taskTable.pointInTimeRecoveryEnabled = true;
  taskTable.deletionProtectionEnabled = true;
  cfnUserPool.deletionProtection = 'ACTIVE';
}

// Record which environment amplify_outputs.json belongs to. Amplify Hosting sets AWS_BRANCH
// during branch deploys; `ampx sandbox` does not. The sandbox-only authorization test
// (npm run test:authz) refuses to run unless this says "sandbox".
backend.addOutput({
  custom: { environment: process.env.AWS_BRANCH ?? 'sandbox' },
});
