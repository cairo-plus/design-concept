// Polyfill for potential missing globals (though TextDecoder is usually in Node 18+)
import "./polyfill";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

// Clients
const s3Client = new S3Client({
    maxAttempts: 3,
});
const bedrockClient = new BedrockRuntimeClient({
    maxAttempts: 5, // Retry up to 5 times for Bedrock throttling
    retryMode: "standard",
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

interface ChunkMetadata {
    source?: string;
    doc_type?: string;
    heading?: string;
    [key: string]: any;
}

interface Chunk {
    id: string;
    text: string;
    metadata?: ChunkMetadata;
}

// Priority Definition
const PRIORITY_ORDER = [
    "past_design_intent", // 設計構想書
    "merchandise_plan", // 商品計画書
    "product_plan", // 製品企画書
    "regulation", // 法規リスト
];

const PRIORITY_KEYWORDS: Record<string, string[]> = {
    regulation: ["法規", "規制", "ルール", "法令", "法律", "基準"],
    merchandise_plan: ["商品", "マーチャンダイジング", "ターゲット", "市場"],
    product_plan: ["製品", "企画", "スペック", "仕様", "諸元"],
    past_design_intent: ["設計", "構想", "意図", "エンジニアリング", "技術"],
};

const DOC_TYPE_LABELS: Record<string, string> = {
    past_design_intent: "設計構想書 (Design Concept)",
    merchandise_plan: "商品計画書 (Merchandise Plan)",
    product_plan: "製品企画書 (Product Plan)",
    regulation: "法規リスト (Regulation List)",
    current_bom: "部品表 (BOM)",
    technical_paper: "技術資料 (Technical Document)",
    competitor_benchmark: "競合比較 (Competitor Benchmark)",
    reflex_rules: "脊髄反射ルール (Reflex Rule)",
};

export const handler = async (event: ChatEvent): Promise<ChatResponse> => {
    console.log("Received event:", JSON.stringify(event));
    const { query, uploadedDocs = [] } = event.arguments;
    const bucketName = process.env.BUCKET_NAME;

    if (!bucketName) {
        return { answer: "Configuration Error: BUCKET_NAME is missing.", citations: [] };
    }

    try {
        // 1. Fetch chunks
        const citations: string[] = [];
        const debugLogs: string[] = [];

        console.log(`Received ${uploadedDocs.length} paths to process.`);

        const targetKeys = uploadedDocs.map((path) => {
            let target = path.replace("public/", "protected/");
            const lastDotIndex = target.lastIndexOf(".");
            if (lastDotIndex !== -1) {
                target = target.substring(0, lastDotIndex);
            }
            return target + "_chunks.json";
        });

        // Store all chunks to sort them later
        const allChunks: Chunk[] = [];

        for (const key of targetKeys) {
            try {
                const getCommand = new GetObjectCommand({
                    Bucket: bucketName,
                    Key: key,
                });
                const response = await s3Client.send(getCommand);
                if (!response.Body) continue;

                const jsonStr = await response.Body.transformToString();
                const fileChunks = JSON.parse(jsonStr);

                if (Array.isArray(fileChunks)) {
                    allChunks.push(...fileChunks);
                }

                // Add to citations list (unique filenames)
                const parts = key.split("/");
                const fileName = parts[parts.length - 1].replace("_chunks.json", "");
                if (!citations.includes(fileName)) {
                    citations.push(fileName);
                }
            } catch (e: any) {
                console.warn(`Could not read chunk file ${key}: ${e.message}`);
            }
        }

        // 2. Sort chunks by Priority
        // Dynamic Priority Adjustment
        let currentPriority = [...PRIORITY_ORDER];
        for (const [type, keywords] of Object.entries(PRIORITY_KEYWORDS)) {
            if (keywords.some(k => query.includes(k))) {
                // Move this type to the front
                currentPriority = [type, ...currentPriority.filter(t => t !== type)];
                console.log(`Dynamic Priority: Promoted ${type} based on query keywords.`);
                break;
            }
        }

        allChunks.sort((a, b) => {
            const typeA = a.metadata?.doc_type || "unknown";
            const typeB = b.metadata?.doc_type || "unknown";

            const indexA = currentPriority.indexOf(typeA);
            const indexB = currentPriority.indexOf(typeB);

            // If both are in the priority list, lower index comes first
            if (indexA !== -1 && indexB !== -1) return indexA - indexB;
            // If only A is in list, A comes first
            if (indexA !== -1) return -1;
            // If only B is in list, B comes first
            if (indexB !== -1) return 1;

            // Neither in list, keep original order
            return 0;
        });

        // 3. Construct Context with Headers
        let context = "";
        let currentType = "";
        const MAX_CONTEXT_LENGTH = 150000; // Sonnet 4.5 has 200k context

        for (const chunk of allChunks) {
            if (context.length > MAX_CONTEXT_LENGTH) break;

            const docType = chunk.metadata?.doc_type || "other";
            const docLabel = DOC_TYPE_LABELS[docType] || "Other Documents";

            if (docType !== currentType) {
                context += `\n\n=== SECTION: ${docLabel} ===\n`;
                currentType = docType;
            }

            const header = chunk.metadata?.heading ? `[Heading: ${chunk.metadata.heading}]` : "";
            const source = chunk.metadata?.source ? `(Source: ${chunk.metadata.source})` : "";

            context += `\n${header} ${source}\n${chunk.text}\n`;
        }

        if (context.length === 0) {
            context = "No relevant documents found.";
        }

        // 4. Construct Prompt for Bedrock
        const systemPrompt = `You are a sophisticated design assistant provided by "Antigravity". 
    Answer the user's question using the provided context documents.

    ## Thinking Process
    Before answering, analyze the user's request and the provided documents step-by-step.
    1. Identify the core question and any specific constraints (e.g. "latest regulations").
    2. Scan the provided context for relevant keywords and concepts.
    3. Evaluate the reliability and priority of the information sources based on the Citation Rules.
    4. Formulate your answer based ONLY on the evidence.
    
    Put your thinking process inside <thinking> tags.
    Put your final user-facing answer inside <answer> tags.
    
    ## Citation Rules (STRICT)
    You MUST prioritize information and citations in this order:
    1. 設計構想書 (Design Concept) - **Highest Priority**
    2. 商品計画書 (Merchandise Plan)
    3. 製品企画書 (Product Plan)
    4. 法規リスト (Regulation List)
    5. Other documents
    
    When citing, explicitly mention the document type and name.
    Example: "According to the Design Concept (File A)..."
    
    ## Fallback / Research Simulation
    If the provided documents DO NOT contain the answer:
    1. Do NOT make up information from the documents.
    2. Instead, use your general knowledge to "search" for the answer.
    3. Use the format: "【ウェブ検索（シミュレーション）】" followed by the answer.
    4. Explicitly cite the likely source of this general knowledge (e.g., "Source: UN Regulation No. 123", "Source: Toyota Global Website").
    
    Current Date: ${new Date().toISOString()}
    `;

        const userMessage = `Context Priority (Top to Bottom):
    ${context}
    
    Question: ${query}`;

        // Invoke Bedrock
        const modelId = "anthropic.claude-sonnet-4-5-20250929-v1:0";

        const payload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 2000,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
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
            // Fallback to 3.5 Sonnet if 4.5 is not available/errored
            if (e.message && (e.message.includes("ResourceNotFound") || e.message.includes("AccessDenied") || e.message.includes("ValidationException") || e.message.includes("supported"))) {
                console.log("Claude 4.5 Sonnet failed, falling back to 3.5 Sonnet...");
                try {
                    const fallbackInvokeCmd = new InvokeModelCommand({
                        modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0",
                        contentType: "application/json",
                        accept: "application/json",
                        body: JSON.stringify(payload),
                    });
                    bedrockResponse = await bedrockClient.send(fallbackInvokeCmd);
                } catch (fallbackError: any) {
                    throw new Error(`Bedrock Fallback Error: ${fallbackError.message}`);
                }
            } else {
                throw new Error(`Bedrock Error: ${e.message}`);
            }
        }

        const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
        const rawText = responseBody.content[0].text;

        // Extract answer from tags if present
        const answerMatch = rawText.match(/<answer>([\s\S]*?)<\/answer>/);
        let answer = answerMatch ? answerMatch[1].trim() : rawText;

        // Clean up thinking tags if they leaked into the fallback
        answer = answer.replace(/<thinking>[\s\S]*?<\/thinking>/g, "").trim();

        return {
            answer,
            citations,
        };
    } catch (error: any) {
        console.error("Handler error:", error);
        return {
            answer: `System Error: ${error.message}\n\nPlease check logs.`,
            citations: [],
        };
    }
};
