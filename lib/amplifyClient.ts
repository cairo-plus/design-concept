import { Amplify, type ResourcesConfig } from "aws-amplify";

// Import amplify outputs if they exist (generated after sandbox/deploy)
let outputs: any = null;
try {
    outputs = require("../amplify_outputs.json");
} catch {
    console.warn("amplify_outputs.json not found. Run 'npx ampx sandbox' to generate it.");
}

const amplifyConfig: ResourcesConfig = outputs ? {
    Auth: {
        Cognito: {
            userPoolId: outputs.auth.user_pool_id,
            userPoolClientId: outputs.auth.user_pool_client_id,
            identityPoolId: outputs.auth.identity_pool_id,
            loginWith: {
                email: true,
            },
            signUpVerificationMethod: "code",
            userAttributes: {
                email: {
                    required: true,
                },
            },
            allowGuestAccess: false,
            passwordFormat: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireNumbers: true,
                requireSpecialCharacters: false,
            },
        },
    },
} : {
    Auth: {
        Cognito: {
            userPoolId: "dummy-pool-id",
            userPoolClientId: "dummy-client-id",
            identityPoolId: "dummy-identity-pool-id",
            loginWith: {
                email: true,
            },
            signUpVerificationMethod: "code",
        },
    },
};

if (outputs) {
    Amplify.configure(amplifyConfig);
}

export { amplifyConfig };
