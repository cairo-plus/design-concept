import { defineBackend } from '@aws-amplify/backend';
import { defineAuth } from '@aws-amplify/backend';
import { defineStorage } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
const auth = defineAuth({
    loginWith: {
        email: true
    }
});

/**
 * Define and configure your storage resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/storage
 */
const storage = defineStorage({
    name: 'designConceptFiles',
    access: (allow) => ({
        'design-concept/*': [
            allow.authenticated.to(['read', 'write']),
        ],
        'public/*': [
            allow.authenticated.to(['read', 'write']),
        ],
    })
});

/**
 * @see https://docs.amplify.aws/gen2/build-a-backend/
 */
const backend = defineBackend({
    auth,
    storage
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
