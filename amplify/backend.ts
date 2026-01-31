import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/auth-res.ts';
import { storage } from './storage/resource.ts';
import { data } from './data/resource.ts';
import { processBedrock } from './functions/process-bedrock/resource.ts';
import { chunkDocuments } from './functions/chunk-documents/resource.ts';
import { ragChat } from './functions/rag-chat/resource.ts';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

/**
 * @see https://docs.amplify.aws/gen2/build-a-backend/
 */
const backend = defineBackend({
    auth,
    storage,
    data,
    processBedrock,
    chunkDocuments,
    ragChat,
});

const bucket = backend.storage.resources.bucket;
const { cfnBucket } = backend.storage.resources.cfnResources;

import { Function } from 'aws-cdk-lib/aws-lambda';
// ...
// Grant permissions to ragChat
const ragChatLambda = backend.ragChat.resources.lambda as Function;
bucket.grantRead(ragChatLambda);
ragChatLambda.addEnvironment("BUCKET_NAME", bucket.bucketName);

ragChatLambda.addToRolePolicy(new PolicyStatement({
    actions: ["bedrock:InvokeModel"],
    resources: ["*"]
}));



// Allow CORS
cfnBucket.corsConfiguration = {
    corsRules: [
        {
            allowedHeaders: ['*'],
            allowedMethods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
            allowedOrigins: ['http://localhost:3000', 'https://*.amplifyapp.com'],
            exposedHeaders: ['x-amz-server-side-encryption', 'x-amz-request-id', 'x-amz-id-2', 'ETag'],
            maxAge: 3000,
        }
    ]
};

// 1. Trigger processBedrock on File Upload (public/...)
const processBedrockLambda = backend.processBedrock.resources.lambda;
const chunkDocumentsLambda = backend.chunkDocuments.resources.lambda;

// Grant S3 permissions
bucket.grantReadWrite(processBedrockLambda);
bucket.grantReadWrite(chunkDocumentsLambda);

// Grant Bedrock permissions to processBedrock
processBedrockLambda.addToRolePolicy(new PolicyStatement({
    actions: [
        "bedrock:InvokeModel",
        "bedrock:Converse"
    ],
    resources: ["*"]
}));

// Add S3 Triggers using addEventNotification
bucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.LambdaDestination(processBedrockLambda),
    { prefix: 'public/' }
);

bucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.LambdaDestination(chunkDocumentsLambda),
    { prefix: 'protected/', suffix: '.md' }
);

