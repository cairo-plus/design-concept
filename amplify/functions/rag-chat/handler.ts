// Polyfill for potential missing globals (though TextDecoder is usually in Node 18+)
import "./polyfill";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import {
    BedrockRuntimeClient,
    InvokeModelCommand,
    InvokeModelWithResponseStreamCommand
} from "@aws-sdk/client-bedrock-runtime";

declare const awslambda: {
    streamifyResponse: (
        handler: (event: any, responseStream: any, context: any) => Promise<void>
    ) => any;
    HttpResponseStream: {
        from: (stream: any, metadata: any) => any;
    };
};

// Clients
const s3Client = new S3Client({
    maxAttempts: 3,
});
const bedrockClient = new BedrockRuntimeClient({
    maxAttempts: 3, // Reduced from 5 to prevent excessive retries
    retryMode: "adaptive", // Use adaptive mode for better backoff
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
 * Keyword-based Sorting (No API calls)
 * Fast alternative to AI reranking for small chunk sets
 */
function keywordBasedSort(query: string, chunks: Chunk[]): Chunk[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

    const scoredChunks = chunks.map(chunk => {
        const textLower = chunk.text.toLowerCase();
        let score = 0;

        // Count keyword matches
        queryTerms.forEach(term => {
            const matches = (textLower.match(new RegExp(term, 'g')) || []).length;
            score += matches;
        });

        // Boost score based on doc_type priority
        const docType = chunk.metadata.doc_type || '';
        const priorityIndex = PRIORITY_ORDER.indexOf(docType);
        if (priorityIndex !== -1) {
            score += (PRIORITY_ORDER.length - priorityIndex) * 2;
        }

        return { ...chunk, metadata: { ...chunk.metadata, score } };
    });

    // Sort by score descending
    return scoredChunks
        .sort((a, b) => (b.metadata.score || 0) - (a.metadata.score || 0))
        .filter(c => (c.metadata.score || 0) > 0); // Keep only relevant chunks
}

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
 * Smart Reranker
 * Uses keyword-based sorting for small sets, AI reranking for larger sets.
 */
async function rerankChunks(query: string, chunks: Chunk[]): Promise<Chunk[]> {
    if (chunks.length === 0) return [];

    // OPTIMIZATION: Use simple keyword sorting for small chunk sets
    const SMART_RERANK_THRESHOLD = 15;

    if (chunks.length < SMART_RERANK_THRESHOLD) {
        console.log(`Small chunk set (${chunks.length}). Using keyword-based sorting only.`);
        return keywordBasedSort(query, chunks);
    }

    // Limited Reranking to save cost/latency: Top 50 chunks max
    const candidates = chunks.slice(0, 50);

    console.log(`Large chunk set. AI reranking ${candidates.length} chunks...`);

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

/**
 * Retrieval Evaluator (CRAG)
 * Uses Claude 3 Haiku to check if retrieved documents are sufficient.
 */
async function evaluateRetrieval(query: string, chunks: Chunk[]): Promise<{ sufficient: boolean; reason: string }> {
    if (chunks.length === 0) return { sufficient: false, reason: "No documents found." };

    // Optimize: Only check top 5 most relevant chunks (by simple keyword match) to save tokens
    const candidates = chunks.slice(0, 5);

    const prompt = `You are a Retrieval Evaluator.
    Query: "${query}"
    
    Review the following document snippets. Determine if they contain sufficient information to answer the query effectively.
    
    Snippets:
    ${JSON.stringify(candidates.map(c => c.text.substring(0, 300)))}
    
    Return ONLY valid JSON:
    {"sufficient": true/false, "reason": "brief explanation"}
    `;

    const payload = {
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 1000,
            system: "You are a JSON-only API. Be critical. If the exact answer isn't clear, return false.",
            messages: [{ role: "user", content: prompt }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const jsonStr = responseBody.content[0].text;
        const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            return JSON.parse(jsonMatch[0]);
        }
        return { sufficient: false, reason: "Failed to parse evaluation." };
    } catch (e) {
        console.warn("Evaluation failed, defaulting to insufficient:", e);
        return { sufficient: false, reason: "Evaluation error." };
    }
}


export const handler = async (event: ChatEvent): Promise<ChatResponse> => {
    console.log("Received event:", JSON.stringify(event));

    // Extract query and uploadedDocs from AppSync event
    const query = event.arguments.query;
    const uploadedDocs = event.arguments.uploadedDocs || [];

    const bucketName = process.env.BUCKET_NAME;

    if (!bucketName) {
        return {
            answer: "Configuration Error: BUCKET_NAME is missing.",
            citations: []
        };
    }

    let answerText = "";
    const citations: string[] = [];

    try {
        // --- 1. Fetch chunks from S3 ---
        const targetKeys = uploadedDocs.map((path) => {
            let target = path.replace("public/", "protected/");
            const lastDotIndex = target.lastIndexOf(".");
            if (lastDotIndex !== -1) {
                target = target.substring(0, lastDotIndex);
            }
            return target + "_chunks.json";
        });

        const allChunks: Chunk[] = [];

        // Parallel Fetch
        const s3Promises = targetKeys.map(async (key) => {
            try {
                const getCommand = new GetObjectCommand({ Bucket: bucketName, Key: key });
                const response = await s3Client.send(getCommand);
                if (!response.Body) return null;
                const jsonStr = await response.Body.transformToString();
                const fileChunks = JSON.parse(jsonStr);

                // Citation tracking
                const parts = key.split("/");
                const fileName = parts[parts.length - 1].replace("_chunks.json", "");

                return { chunks: fileChunks, fileName };
            } catch (e: any) {
                console.warn(`Could not read chunk file ${key}: ${e.message}`);
                return null;
            }
        });

        const s3Results = await Promise.all(s3Promises);

        s3Results.forEach((res: any) => {
            if (res) {
                if (Array.isArray(res.chunks)) allChunks.push(...res.chunks);
                if (!citations.includes(res.fileName)) citations.push(res.fileName);
            }
        });

        // --- 2. Smart Evaluation & Conditional Web Search (CRAG) ---
        let webChunks: Chunk[] = [];

        // Always search if no S3 docs found
        let shouldSearchWeb = allChunks.length === 0;
        let evalReason = "No internal documents found.";

        if (!shouldSearchWeb) {
            // OPTIMIZATION: Skip expensive AI evaluation if we have good keyword matches
            const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
            const chunksWithMatches = allChunks.filter(chunk => {
                const textLower = chunk.text.toLowerCase();
                return queryTerms.some(term => textLower.includes(term));
            });

            const SUFFICIENT_CHUNK_THRESHOLD = 10;

            if (chunksWithMatches.length >= SUFFICIENT_CHUNK_THRESHOLD) {
                // We have plenty of documents with keyword matches - skip AI evaluation
                console.log(`Sufficient internal documents found (${chunksWithMatches.length} with keyword matches). Skipping CRAG evaluation.`);
                shouldSearchWeb = false;
                evalReason = "Sufficient internal documents with keyword matches.";
            } else {
                // We have some docs but not many matches - skip web search anyway for simplicity
                shouldSearchWeb = false;
                evalReason = "Some internal documents found.";
                console.log(`Skipping web search: ${evalReason}`);
            }
        }

        if (shouldSearchWeb) {
            answerText += "Insufficient information found. Searching the web...\n\n";
            try {
                webChunks = await searchWeb(query);
                console.log(`Web search returned ${webChunks.length} chunks.`);
                if (webChunks.length > 0) {
                    citations.push(...webChunks.map(c => c.metadata.source).filter((v, i, a) => a.indexOf(v) === i));
                }
            } catch (webError: any) {
                console.error("Web search failed:", webError);
                answerText += `(Web search unavailable: ${webError.message})\n\n`;
            }
        }

        // --- 3. Combine all chunks & Rerank ---
        const combinedChunks = [...allChunks, ...webChunks];

        if (combinedChunks.length === 0) {
            return {
                answer: "申し訳ございません。関連する情報が見つかりませんでした。\n\nもう少し具体的に質問していただけますか？",
                citations: []
            };
        }

        const rankedChunks = await rerankChunks(query, combinedChunks);
        console.log(`Reranked ${rankedChunks.length} chunks.`);

        // --- 4. Build context for LLM ---
        const TOP_K = 20;
        const topChunks = rankedChunks.slice(0, TOP_K);

        let context = "";
        topChunks.forEach((chunk, idx) => {
            const source = chunk.metadata.source || "Unknown";
            const heading = chunk.metadata.heading || "";
            const scoreStr = chunk.metadata.score !== undefined ? ` [Score: ${chunk.metadata.score.toFixed(2)}]` : "";
            context += `[${idx + 1}] (${source})${heading ? ` - ${heading}` : ""}${scoreStr}\n${chunk.text.trim()}\n\n`;
        });

        const systemPrompt = `You are a helpful design assistant. Answer the user's question based on the provided context.
- If the context contains relevant information, use it to provide a detailed answer in Japanese.
- If the context doesn't contain enough information, say so honestly in Japanese.
- Always cite sources using [source name] when referencing information.
- Format your response in markdown for better readability.`;

        const contextMessage = `Context Priority (Top to Bottom):
    ${context}`;

        // Use Claude 3.5 Sonnet v1 - v2 doesn't support on-demand throughput in ap-northeast-1
        console.log("Using Model ID: anthropic.claude-3-5-sonnet-20240620-v1:0");
        const modelId = "anthropic.claude-3-5-sonnet-20240620-v1:0";

        // NOTE: Prompt Caching is disabled because Claude 3.5 Sonnet v1 doesn't support it
        // Only v2 supports prompt caching, but v2 doesn't support on-demand throughput in Tokyo
        const payload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 3000,
            system: [
                {
                    type: "text",
                    text: systemPrompt
                }
            ],
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: contextMessage
                        },
                        {
                            type: "text",
                            text: `Question: ${query}`
                        }
                    ]
                }
            ],
        };

        const streamCommand = new InvokeModelWithResponseStreamCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(payload),
        });

        try {
            const response = await bedrockClient.send(streamCommand);

            if (response.body) {
                for await (const chunk of response.body) {
                    if (chunk.chunk && chunk.chunk.bytes) {
                        const decoded = new TextDecoder().decode(chunk.chunk.bytes);
                        const parsed = JSON.parse(decoded);
                        if (parsed.type === "content_block_delta" && parsed.delta && parsed.delta.text) {
                            answerText += parsed.delta.text;
                        }
                    }
                }
            }
        } catch (e: any) {
            console.error("Bedrock Stream Error:", e);

            // Check if it's a rate limit error (429)
            if (e.name === 'ThrottlingException' || e.$metadata?.httpStatusCode === 429) {
                answerText += `\n\n申し訳ございません。現在リクエストが集中しているため、少し時間をおいてから再度お試しください。\n\n(Error: Too many requests - please wait a moment and try again)\n`;
            } else {
                answerText += `\n\n回答の生成中にエラーが発生しました: ${e.message}\n\n(Error generating response: ${e.message})\n`;
            }
        }

        // Append Citations
        if (citations.length > 0) {
            answerText += `\n\n---\n**参考資料:**\n`;
            citations.forEach(c => answerText += `- ${c}\n`);
        }

    } catch (error: any) {
        console.error("Handler error:", error);
        answerText = `System Error: ${error.message}`;
    }

    return {
        answer: answerText,
        citations: citations
    };
};
