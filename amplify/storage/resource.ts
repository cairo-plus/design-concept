import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
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
