import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';

/**
 * @see https://docs.amplify.aws/gen2/build-a-backend/
 */
const backend = defineBackend({
    auth,
    storage
});
