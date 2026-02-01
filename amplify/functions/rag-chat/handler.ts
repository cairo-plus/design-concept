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
    source: string;
    doc_type?: string;
    heading?: string;
    url?: string;
    score?: number; // Rerank score
    [key: string]: any;
}

interface Chunk {
    id: string;
    text: string;
    metadata: ChunkMetadata;
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
    web_search: "Web検索結果 (Internet Search)",
};

/**
 * Tavily API for Web Search
 */
async function searchWeb(query: string): Promise<Chunk[]> {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
        console.warn("TAVILY_API_KEY is not set. Skipping web search.");
        return [];
    }

    // Simple heuristic: Only search if query implies outside knowledge or explicitly asks for it
    // But for now, let's search if the query is reasonably long or contains "latest"/"2025" etc.
    const needsSearch = query.length > 5; // Search for almost everything to be safe, or refine heuristic
    if (!needsSearch) return [];

    console.log(`Executing Web Search for: ${query}`);

    try {
        const response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                api_key: apiKey,
                query: query,
                search_depth: "advanced",
                include_answer: true,
                max_results: 5,
            }),
        });

        if (!response.ok) {
            throw new Error(`Tavily API error: ${response.statusText}`);
        }

        const data = await response.json();
        const results = data.results || [];

        return results.map((r: any, i: number) => ({
            id: `web-search-${i}`,
            text: `Title: ${r.title}\nURL: ${r.url}\nContent: ${r.content}`,
            metadata: {
                source: `Web: ${r.title}`,
                doc_type: "web_search",
                url: r.url,
                heading: r.title
            }
        }));

    } catch (error) {
        console.error("Web Search Failed:", error);
        return [];
    }
}

/**
 * LLM-based Reranker
 * Uses Claude 3 Haiku (fast) or Sonnet to score relevance.
 */
async function rerankChunks(query: string, chunks: Chunk[]): Promise<Chunk[]> {
    if (chunks.length === 0) return [];

    // Limited Reranking to save cost/latency: Top 50 chunks max
    const candidates = chunks.slice(0, 50);

    console.log(`Reranking ${candidates.length} chunks...`);

    const prompt = `You are a Relevance Ranking Assistant.
    Query: "${query}"
    
    Rate the RELEVANCE of each document chunk to the query on a scale of 0 to 10.
    10 = Perfect answer / Highly relevant facts
    0 = Completely irrelevant
    
    Output ONLY valid JSON in this format:
    {"scores": [{"id": "chunk_id", "score": 9}, ...]}
    
    Chunks to evaluate:
    ${JSON.stringify(candidates.map(c => ({ id: c.id, text: c.text.substring(0, 500) })))}
    `;

    const payload = {
        modelId: "anthropic.claude-3-haiku-20240307-v1:0", // Fast model for reranking
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 4000,
            system: "You are a JSON-only API.",
            messages: [{ role: "user", content: prompt }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const jsonStr = responseBody.content[0].text;

        // Extract JSON carefully
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return candidates; // Fallback to original order

        const scores: { id: string, score: number }[] = JSON.parse(jsonMatch[0]).scores;

        // Map scores back to chunks
        const scoredChunks = candidates.map(chunk => {
            const scoreItem = scores.find(s => s.id === chunk.id);
            return { ...chunk, metadata: { ...chunk.metadata, score: scoreItem ? scoreItem.score : 0 } };
        });

        // Filter out low relevance (< 3) and Sort by score desc
        return scoredChunks
            .filter(c => (c.metadata.score || 0) >= 4) // Threshold
            .sort((a, b) => (b.metadata.score || 0) - (a.metadata.score || 0));

    } catch (e) {
        console.error("Reranking failed, using original order:", e);
        return candidates; // Fallback
    }
}

export const handler = async (event: ChatEvent): Promise<ChatResponse> => {
    console.log("Received event:", JSON.stringify(event));
    const { query, uploadedDocs = [] } = event.arguments;
    const bucketName = process.env.BUCKET_NAME;

    if (!bucketName) {
        return { answer: "Configuration Error: BUCKET_NAME is missing.", citations: [] };
    }

    try {
        // 1. Fetch chunks from S3
        const citations: string[] = [];
        const targetKeys = uploadedDocs.map((path) => {
            let target = path.replace("public/", "protected/");
            const lastDotIndex = target.lastIndexOf(".");
            if (lastDotIndex !== -1) {
                target = target.substring(0, lastDotIndex);
            }
            return target + "_chunks.json";
        });

        const allChunks: Chunk[] = [];

        // Fetch S3 docs
        for (const key of targetKeys) {
            try {
                const getCommand = new GetObjectCommand({ Bucket: bucketName, Key: key });
                const response = await s3Client.send(getCommand);
                if (!response.Body) continue;
                const jsonStr = await response.Body.transformToString();
                const fileChunks = JSON.parse(jsonStr);
                if (Array.isArray(fileChunks)) {
                    allChunks.push(...fileChunks);
                }
                // Citation tracking
                const parts = key.split("/");
                const fileName = parts[parts.length - 1].replace("_chunks.json", "");
                if (!citations.includes(fileName)) citations.push(fileName);
            } catch (e: any) {
                console.warn(`Could not read chunk file ${key}: ${e.message}`);
            }
        }

        // 2. Fetch Web Search Results
        const webChunks = await searchWeb(query);
        allChunks.push(...webChunks); // Add web results to pool

        webChunks.forEach(wc => {
            if (wc.metadata.url && !citations.includes(`Web: ${wc.metadata.heading}`)) {
                citations.push(`[${wc.metadata.heading}](${wc.metadata.url})`);
            }
        });

        // 3. Reranking (The core improvement)
        // If we have too many chunks, strict reranking is needed.
        // If few, we can skip or do light sorting.
        let rankedChunks = await rerankChunks(query, allChunks);

        // Fallback if rerank killed everything (too strict?)
        if (rankedChunks.length === 0 && allChunks.length > 0) {
            console.log("Reranking removed all chunks, recovering top original chunks.");
            rankedChunks = allChunks.slice(0, 20);
        }

        // 4. Construct Context
        let context = "";
        const MAX_CONTEXT_LENGTH = 150000;

        for (const chunk of rankedChunks) {
            if (context.length > MAX_CONTEXT_LENGTH) break;

            const docType = chunk.metadata.doc_type || "other";
            const docLabel = DOC_TYPE_LABELS[docType] || "Other Documents";
            const header = chunk.metadata.heading ? `[Heading: ${chunk.metadata.heading}]` : "";
            const source = chunk.metadata.source ? `(Source: ${chunk.metadata.source})` : "";
            const score = chunk.metadata.score ? `(Relevance: ${chunk.metadata.score}/10)` : "";

            context += `\n=== SOURCE: ${docLabel} ${score} ===\n`;
            context += `${header} ${source}\n${chunk.text}\n`;
        }

        if (!context) context = "No relevant documents found.";

        // 5. Final Generation
        const systemPrompt = `You are a sophisticated Design Assistant (設計アシスタント). 
    Answer the user's question using the provided context documents.
    
    ## Thinking Process
    1. Identify the core question and any specific constraints (e.g. "latest regulations").
    2. Scan the provided context for relevant keywords and concepts.
    3. Evaluate the reliability and priority. **Web Search results are highly reliable for latest trends/news (2024-2025).**
    4. Formulate your answer based ONLY on the evidence.
    
    ## Citation Rules (STRICT)
    You MUST prioritize information and citations in this order:
    1. Web Search Results (for latest regulations/trends)
    2. 設計構想書 (Design Concept)
    3. 商品計画書 (Merchandise Plan)
    4. 製品企画書 (Product Plan)
    5. 法規リスト (Regulation List)
    
    When citing, explicitly mention the document type and name.
    Example: "According to the Design Concept (File A)..." or "As seen in the Web Search Result [Title](URL)..."
    
    Current Date: ${new Date().toISOString()}
    `;

        const userMessage = `Context Priority (Top to Bottom):
    ${context}
    
    Question: ${query}`;

        // Invoke Bedrock
        // Cross-Region Inference Profile for Claude 3.5 Sonnet v2 (US Region)
        const modelId = "us.anthropic.claude-3-5-sonnet-20241022-v2:0";

        const payload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 3000,
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
            // Fallback to older 3.5 Sonnet (Tokyo Region / Standard) if Cross-Region fails
            console.log("Cross-Region Inference failed, falling back to standard 3.5 Sonnet...");
            try {
                const fallbackCmd = new InvokeModelCommand({
                    modelId: "anthropic.claude-3-5-sonnet-20240620-v1:0", // Standard Tokyo ID
                    contentType: "application/json",
                    accept: "application/json",
                    body: JSON.stringify(payload),
                });
                bedrockResponse = await bedrockClient.send(fallbackCmd);
            } catch (fallbackError: any) {
                // Last resort: Haiku
                console.log("3.5 Sonnet failed, falling back to Haiku...");
                const haikuCmd = new InvokeModelCommand({
                    modelId: "anthropic.claude-3-haiku-20240307-v1:0",
                    contentType: "application/json",
                    accept: "application/json",
                    body: JSON.stringify(payload),
                });
                bedrockResponse = await bedrockClient.send(haikuCmd);
            }
        }

        const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
        const answer = responseBody.content[0].text;

        return {
            answer,
            citations, // This now includes Web URLs
        };

    } catch (error: any) {
        console.error("Handler error:", error);
        return {
            answer: `System Error: ${error.message}\n\nPlease check logs.`,
            citations: [],
        };
    }
};
