import { type ClientSchema, a, defineData } from '@aws-amplify/backend';
import { ragChat } from '../functions/rag-chat/resource.ts';

const schema = a.schema({
    ChatResponse: a.customType({
        answer: a.string(),
        citations: a.string().array(),
    }),

    UserDocument: a.model({
        docType: a.string().required(),
        fileName: a.string().required(),
        s3Path: a.string().required(),
        uploadedAt: a.string(),
        isDeleted: a.boolean(),
    })
        .authorization(allow => [allow.owner()]),

    InteractionHistory: a.model({
        type: a.string().required(), // "CHAT" | "DESIGN_DRAFT"
        query: a.string().required(),
        response: a.string().required(),
        usedSources: a.string().array(),
        createdAt: a.datetime(),
    })
        .authorization(allow => [allow.owner()]),

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
