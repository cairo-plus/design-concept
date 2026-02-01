// Polyfill for potential missing globals (though TextDecoder is usually in Node 18+)
import "./polyfill";
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import axios from 'axios';

// Clients
const s3Client = new S3Client({
    maxAttempts: 3
});
const bedrockClient = new BedrockRuntimeClient({
    maxAttempts: 5, // Retry up to 5 times for Bedrock throttling
    retryMode: "standard"
});

// Types
interface ChatEvent {
    arguments: {
        query: string;
        uploadedDocs?: string[]; // Optional list of doc names to prioritize
    };
}

interface ChatResponse {
    answer: string;
    citations: string[];
}

export const handler = async (event: ChatEvent): Promise<ChatResponse> => {
    console.log("Received event:", JSON.stringify(event));
    const { query, uploadedDocs = [] } = event.arguments;
    const bucketName = process.env.BUCKET_NAME;

    if (!bucketName) {
        return { answer: "Configuration Error: BUCKET_NAME is missing.", citations: [] };
    }

    try {
        // 1. Fetch relevant files using direct paths
        let context = "";
        const citations: string[] = [];
        const debugLogs: string[] = [];

        // uploadedDocs now contains full S3 paths (e.g. "public/Plan/20230101/A.pdf")
        console.log(`Received ${uploadedDocs.length} paths to process.`);

        const targetKeys = uploadedDocs.map(path => {
            // Transform public/ path to protected/ chunk path
            // 1. public/ -> protected/
            // 2. Extension -> _chunks.json
            // Example: public/A/B/file.pdf -> protected/A/B/file_chunks.json

            let target = path.replace("public/", "protected/");
            const lastDotIndex = target.lastIndexOf(".");
            if (lastDotIndex !== -1) {
                target = target.substring(0, lastDotIndex);
            }
            return target + "_chunks.json";
        });

        console.log("Target chunk keys:", targetKeys);

        for (const key of targetKeys) {
            try {
                const getCommand = new GetObjectCommand({
                    Bucket: bucketName,
                    Key: key,
                });
                const response = await s3Client.send(getCommand);

                if (!response.Body) continue;

                const jsonStr = await response.Body.transformToString();
                const chunks = JSON.parse(jsonStr);

                // Concatenate text from all chunks
                let fileText = "";
                if (Array.isArray(chunks)) {
                    fileText = chunks.map((c: any) => {
                        const header = c.metadata?.heading ? `[${c.metadata.heading}] ` : "";
                        return `${header}${c.text}`;
                    }).join("\n\n");
                }

                const truncatedText = fileText.slice(0, 50000);
                context += `\n--- Document: ${key} ---\n${truncatedText}\n`;

                // Citation logic: use original filename derived from key
                // Key: protected/Type/Time/File_chunks.json -> File
                const parts = key.split('/');
                const fileName = parts[parts.length - 1].replace('_chunks.json', '');
                citations.push(fileName);

            } catch (e: any) {
                // If file not found, it might still be processing. We skip it but log.
                console.warn(`Could not read chunk file ${key}: ${e.message}`);
                // debugLogs.push(`Missing: ${key}`); 
            }
        }

        // 2. Construct Prompt for Bedrock
        const systemPrompt = `You are a helpful design assistant. 
    Answer the user's question using ONLY the provided context documents.
    
    CRITICAL: Output Format
    You MUST output the response in the format of a "設計構想書" (Design Concept Request) as follows:

    # 設計構想書
    
    **テーマ**: {Topic Name}
    **起案日**: ${new Date().toISOString().split('T')[0]}
    **作成者**: AI Assistant

    ## 1. 目的
    (Describe the purpose and objectives)

    ## 2. 現状の課題
    (Describe current issues, background, or problems to solve)

    ## 3. ベンチマーク
    (Describe benchmarks, reference models, or competitor analysis)

    ## 4. 設計コンセプト
    (Describe the proposed design concept, key features, and technical approach)

    CRITICAL RULES FOR CONTENT:
    1. The structure above is MANDATORY, but the CONTENT must be extracted strictly from the provided context documents.
    2. Do NOT use any example text or general knowledge to fill these sections unless it exists in the documents.
    3. If the context documents do not contain information for a specific section, write "Not mentioned in documents" or equivalent.
    4. This format applies to ANY component or topic (e.g., Tailgate, Seats, Doors, Engine, etc.). Do NOT assume the content involves "Seats" or "Crown Sedan" unless the documents specifically say so.
    
     CRITICAL: You MUST prioritize citations in the following order:
    1. 設計構想書 (Design Concept)
    2. 商品計画書 (Product Plan)
    3. 製品企画書 (Product Planning)
    4. 法規リスト (Regulation List)
    
    If the answer is explicitly found in the documents, cite the document name.
    If the answer is NOT found in the documents, and context was provided, invoke the <search_needed/> tag.
    If NO context was provided, answer from your general knowledge but mention that no documents were found.

    CRITICAL: You MUST answer in Japanese. Do NOT use English.
    `;

        const userMessage = `Context:
    ${context}
    
    Question: ${query}`;

        // Invoke Bedrock (Claude 3.5 Sonnet)
        const modelId = "anthropic.claude-3-5-sonnet-20240620-v1:0";

        const payload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            system: systemPrompt,
            messages: [
                { role: "user", content: userMessage }
            ]
        };

        const invokeCommand = new InvokeModelCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(payload),
        });

        let bedrockResponse;
        try {
            bedrockResponse = await bedrockClient.send(invokeCommand);
        } catch (e: any) {
            console.error("Bedrock Invoke Error:", e);
            throw new Error(`Bedrock Error: ${e.message}`);
        }

        const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
        let answer = responseBody.content[0].text;

        // 3. Fallback / "Internet Search" Simulation -> REAL Tavily Search
        // If the model says search is needed, we interpret that as "Not in docs".
        if (answer.includes("<search_needed/>")) {
            console.log("Fallback to Internet Search triggered.");

            let searchContext = "";
            let searchCitations: string[] = [];

            try {
                // Call Tavily API
                const tavilyKey = process.env.TAVILY_API_KEY;
                if (!tavilyKey) {
                    throw new Error("TAVILY_API_KEY is not set.");
                }

                const searchResponse = await axios.post("https://api.tavily.com/search", {
                    api_key: tavilyKey,
                    query: query,
                    search_depth: "advanced",
                    include_answer: true,
                    max_results: 5
                });

                const results = searchResponse.data.results || [];
                const searchAnswer = searchResponse.data.answer || "";

                searchContext = `Tavily Search Summary: ${searchAnswer}\n\nSearch Results:\n` +
                    results.map((r: any) => `- [${r.title}](${r.url}): ${r.content}`).join("\n");

                // Collect sources for frontend display if needed, though we usually just put them in the text
                searchCitations = results.map((r: any) => `[${r.title}](${r.url})`);

            } catch (searchError: any) {
                console.error("Tavily Search failed:", searchError);
                searchContext = "Internet search failed. Please try again later or check configuration.";
            }

            const fallbackPrompt = `You are a helpful assistant. The user asked: "${query}".
        You previously couldn't find the answer in the provided files.
        We performed an internet search and found the following results:
        
        ${searchContext}

        Please answer the user's question using ONLY the search results provided above.
        
        CRITICAL: Output Format
        You MUST output the response in the format of a "設計構想書" (Design Concept Request) as follows:

        # 設計構想書
        
        **テーマ**: {Topic Name}
        **起案日**: ${new Date().toISOString().split('T')[0]}
        **作成者**: AI Assistant

        ## 1. 目的
        (Describe the purpose and objectives based on search results)

        ## 2. 現状の課題
        (Describe current issues, background, or problems based on search results)

        ## 3. ベンチマーク
        (Describe benchmarks, reference models, or competitor analysis based on search results)

        ## 4. 設計コンセプト
        (Describe the proposed design concept, key features, and technical approach based on search results)

        Review the search results and cite the sources explicitly in your response using the format: [Title](URL).
        Prioritize high-reliability sources (papers, laws, official manufacturers) if available in the results.
        
        CRITICAL: You MUST answer in Japanese. Do NOT use English.
        `;

            const fallbackPayload = {
                anthropic_version: "bedrock-2023-05-31",
                max_tokens: 1000,
                messages: [
                    { role: "user", content: fallbackPrompt }
                ]
            };

            const fallbackInvoke = new InvokeModelCommand({
                modelId,
                contentType: "application/json",
                accept: "application/json",
                body: JSON.stringify(fallbackPayload),
            });

            const fallbackResponse = await bedrockClient.send(fallbackInvoke);
            const fallbackBody = JSON.parse(new TextDecoder().decode(fallbackResponse.body));
            answer = fallbackBody.content[0].text;

            // Clear file citations, replace with search citations or note
            citations.splice(0, citations.length);
            // We can push the generic "Internet Search" or specific domains if we want granular chips
            // For now, let's add a "Internet Search" chip
            citations.push("Internet Search");
        }

        // Append debug logs if answer is empty or error-like, for visibility during dev
        if (!answer) {
            answer = "Generated answer was empty.";
            if (debugLogs.length > 0) {
                answer += "\n\nDebug Logs:\n" + debugLogs.join("\n");
            }
        }

        return {
            answer,
            citations
        };

    } catch (error: any) {
        console.error("Handler error:", error);
        // RETURN the error as the answer so it's visible in the UI
        return {
            answer: `System Error: ${error.message}\n\nPlease check logs.`,
            citations: []
        };
    }
};
