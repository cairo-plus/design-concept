// Streaming RAG Chat via AppSync GraphQL
// This calls the ragChat query which is connected to the Lambda function
import { generateClient } from 'aws-amplify/data';
import type { Schema } from '@/amplify/data/resource';

const client = generateClient<Schema>();

export async function streamRagChat(
    query: string,
    uploadedDocs: string[],
    onChunk: (text: string) => void
): Promise<void> {
    try {
        // Call the ragChat query via AppSync
        console.log('Calling ragChat with:', { query, uploadedDocs });
        const response = await client.queries.ragChat({
            query: query,
            uploadedDocs: uploadedDocs.length > 0 ? uploadedDocs : undefined
        });

        console.log('RagChat response:', response);
        console.log('Response data:', response.data);
        console.log('Response errors:', response.errors);
        console.log('Response answer:', response.data?.answer);

        // The response data contains the full answer
        if (response.data?.answer) {
            // Since AppSync doesn't support true streaming yet, we'll simulate
            // by breaking the response into chunks for a better UX
            const fullText = response.data.answer;
            const chunkSize = 50; // Characters per chunk

            for (let i = 0; i < fullText.length; i += chunkSize) {
                const chunk = fullText.substring(i, Math.min(i + chunkSize, fullText.length));
                onChunk(chunk);

                // Small delay to simulate streaming
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        } else {
            console.warn('No answer in response:', response);
            throw new Error('No answer received from server');
        }
    } catch (error: any) {
        console.error('RagChat query failed:', error);
        throw new Error(error.message || 'Failed to fetch chat response');
    }
}

