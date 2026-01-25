import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/auth-resource.js';

/**
 * @see https://docs.amplify.aws/gen2/build-a-backend/
 */
const backend = defineBackend({
    auth,
});
