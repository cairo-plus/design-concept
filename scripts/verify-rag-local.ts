import { handler } from '../amplify/functions/rag-chat/handler';

// Mock environment
process.env.BUCKET_NAME = 'amplify-d36x7v8ch44hay-ma-designconceptfilesbucket-bsc5b7uvescf';
process.env.TAVILY_API_KEY = 'tvly-mock-key'; // Mock key or empty to test fallback

async function testHandler() {
    console.log("🚀 Starting Local Handler Verification...");

    const mockEvent = {
        arguments: {
            query: "What is the latest version of Next.js?",
            uploadedDocs: [] // Empty to trigger search fallback
        }
    };

    try {
        console.log("Invoking handler with query:", mockEvent.arguments.query);
        const result = await handler(mockEvent);
        console.log("\n✅ Handler returned result:");
        console.log("Answer:", result.answer);
        console.log("Citations:", result.citations);

        if (result.answer.includes("System Error")) {
            console.warn("⚠️ System Error detected in answer (Expected if no AWS creds locally).");
        }
    } catch (e: any) {
        console.error("❌ Handler threw an exception:", e);
    }
}

(async () => {
    await testHandler();
})();
