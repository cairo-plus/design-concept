import { defineStorage } from '@aws-amplify/backend';

export const storage = defineStorage({
    name: 'designConceptFiles',
    access: (allow) => ({
        'design-concept/*': [
            allow.guest.to(['read', 'write']),
            allow.authenticated.to(['read', 'write']),
        ],
        // Allow public access to support the current mock auth flow where everyone might be treated as guest
        'public/*': [
            allow.guest.to(['read', 'write']),
            allow.authenticated.to(['read', 'write']),
        ]
    })
});
