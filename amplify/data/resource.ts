import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { ragChat } from '../functions/rag-chat/resource';

const schema = a.schema({
    ChatResponse: a.customType({
        answer: a.string(),
        citations: a.string().array(),
    }),

    ragChat: a
        .query()
        .arguments({
            query: a.string().required(),
            uploadedDocs: a.string().array(),
        })
        .returns(a.ref('ChatResponse'))
        .authorization(allow => [allow.authenticated()])
        .handler(a.handler.function(ragChat))
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
    schema,
    authorizationModes: {
        defaultAuthorizationMode: 'userPool',
    },
});
