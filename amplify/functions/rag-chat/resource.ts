import { defineFunction } from '@aws-amplify/backend';

export const ragChat = defineFunction({
    name: 'rag-chat',
    entry: './handler.ts',
    timeoutSeconds: 60, // Bedrock might take time
    memoryMB: 512, // PDF parsing might need memory
    resourceGroupName: 'data',
});
