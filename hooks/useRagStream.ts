import { RAG_CHAT_FUNCTION_URL } from '../rag-config';

export async function streamRagChat(
    query: string,
    uploadedDocs: string[],
    onChunk: (text: string) => void
): Promise<void> {
    if (!RAG_CHAT_FUNCTION_URL) {
        throw new Error("RAG Chat URL is not configured. Please check rag-config.ts");
    }

    const response = await fetch(RAG_CHAT_FUNCTION_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ query, uploadedDocs })
    });

    if (!response.ok) {
        throw new Error(`Server Error: ${response.statusText}`);
    }

    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            onChunk(text);
        }
    } catch (e) {
        console.error("Stream reading failed", e);
        throw e;
    } finally {
        reader.releaseLock();
    }
}
