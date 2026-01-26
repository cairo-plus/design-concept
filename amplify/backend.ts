import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';

/**
 * @see https://docs.amplify.aws/gen2/build-a-backend/
 */
const backend = defineBackend({
    auth,
    storage,
});


const { cfnBucket } = backend.storage.resources.cfnResources;

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
