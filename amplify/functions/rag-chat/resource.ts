import { defineFunction, secret } from '@aws-amplify/backend';

export const ragChat = defineFunction({
    name: 'rag-chat',
    entry: './handler.ts',
    timeoutSeconds: 300, // Increased for Search + Rerank latency
    memoryMB: 1024, // Increased for handling more chunks
    resourceGroupName: 'data',
    environment: {
        TAVILY_API_KEY: secret('TAVILY_API_KEY')
    }
});
