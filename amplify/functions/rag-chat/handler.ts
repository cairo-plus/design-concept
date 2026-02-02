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
/**
 * Keyword-based Sorting (Enhanced)
 * Scored based on:
 * 1. Term frequency in body
 * 2. Term frequency in heading (High Boost)
 * 3. Exact phrase matches
 * 4. Document Type Priority
 * 5. Recency (Dates)
 */
/**
 * Query Expansion
 * Uses Claude 3 Haiku to generate synonyms and related terms.
 */
async function generateSearchQueries(originalQuery: string): Promise<string[]> {
    // Skip expansion for very short queries
    if (originalQuery.length < 3) return [originalQuery];

    const prompt = `You are a Search Specialist.
    User Query: "${originalQuery}"

    Generate 3 alternative search queries to find relevant information in technical documentation (design specs, regulations, plans) or web search.
    - Include synonyms (e.g., "spec" -> "specification", "dimensions").
    - Break down complex questions.
    - Keep them short and specific.

    Output JSON ONLY: ["query1", "query2", "query3"]`;

    const payload = {
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 300,
            system: "You are a JSON-only API.",
            messages: [{ role: "user", content: prompt }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const jsonMatch = responseBody.content[0].text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            const queries = JSON.parse(jsonMatch[0]);
            console.log(`Query Expanded: "${originalQuery}" -> ${JSON.stringify(queries)}`);
            return [originalQuery, ...queries];
        }
        return [originalQuery];
    } catch (e) {
        console.warn("Query expansion failed:", e);
        return [originalQuery];
    }
}

/**
 * Intelligent Web Search Router
 * Decides if the query requires external information.
 */
async function shouldTriggerWebSearch(query: string): Promise<boolean> {
    // 1. Rule-based triggers (Fast & Cheap)
    const forcedKeywords = [
        "stock", "price", "株価",
        "news", "trend", "latest", "最新",
        "2025", "2026", "future", "将来",
        "competitor", "market", "市場"
    ];
    const lowercaseQuery = query.toLowerCase();
    if (forcedKeywords.some(kw => lowercaseQuery.includes(kw))) {
        console.log("Web Search Triggered by Keyword Rule.");
        return true;
    }

    // 2. LLM Router (Claude Haiku) - Low latency check
    const prompt = `You are a Router.
    Query: "${query}"

    Determine if this query should check external web sources.
    Answer TRUE if:
    1. The query asks for real-time information (news, stock prices, future trends).
    2. The query asks for general knowledge likely not in internal technical docs (e.g., "CEO of X", "Capital of Y").
    3. The internal static documents (design specs, regulations) are likely insufficient.
    
    Output JSON ONLY: {"search": true/false}`;

    const payload = {
        modelId: "anthropic.claude-3-haiku-20240307-v1:0",
        contentType: "application/json",
        accept: "application/json",
        body: JSON.stringify({
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 100,
            system: "You are a JSON-only API.",
            messages: [{ role: "user", content: prompt }]
        })
    };

    try {
        const command = new InvokeModelCommand(payload);
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));
        const jsonMatch = responseBody.content[0].text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const result = JSON.parse(jsonMatch[0]).search;
            console.log(`Router Decision: ${result}`);
            return result === true;
        }
    } catch (e) {
        console.warn("Router failed:", e);
    }

    return false;
}

/**
 * Keyword-based Sorting (Enhanced)
 * Scored based on:
 * 1. Term frequency in body
 * 2. Term frequency in heading (High Boost)
 * 3. Exact phrase matches
 * 4. Document Type Priority
 * 5. Recency (Dates)
 */
function keywordBasedSort(query: string, chunks: Chunk[]): Chunk[] {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const queryLower = query.toLowerCase();

    // Heuristic for "latest" or "new"
    const asksForLatest = queryLower.includes("latest") || queryLower.includes("最新") || queryLower.includes("直近");

    const scoredChunks = chunks.map(chunk => {
        const textLower = chunk.text.toLowerCase();
        const headingLower = (chunk.metadata.heading || "").toLowerCase();
        let score = 0;

        // 1. Term Frequency in Body
        queryTerms.forEach(term => {
            // Simple count (avoiding regex overhead for every term if possible, but regex is accurate)
            const matches = textLower.split(term).length - 1;
            score += matches * 1.0;
        });

        // 2. Term Frequency in Heading (Boost)
        queryTerms.forEach(term => {
            if (headingLower.includes(term)) {
                score += 5.0; // Heading match is highly relevant
            }
        });

        // 3. Exact Phrase Match Bonus
        if (textLower.includes(queryLower)) {
            score += 3.0;
        }

        // 4. Doc Type Priority
        const docType = chunk.metadata.doc_type || '';
        const priorityIndex = PRIORITY_ORDER.indexOf(docType);
        if (priorityIndex !== -1) {
            // Priority 0 (highest) gets largest boost
            score += (PRIORITY_ORDER.length - priorityIndex) * 2;
        }

        // 5. Recency Bonus
        // If user asks for "latest", boost chunks having recent years
        if (asksForLatest) {
            const currentYear = new Date().getFullYear();
            if (textLower.includes(String(currentYear)) || textLower.includes(String(currentYear + 1)) || textLower.includes("令和6年")) {
                score += 5.0;
            }
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
    const needsSearch = query.length > 2; // Reduced from 5 to allow shorter queries
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
                exclude_domains: [
                    "youtube.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "tiktok.com",
                    "pinterest.com", "reddit.com", "quora.com", "chiebukuro.yahoo.co.jp"
                ]
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
 * Smart Reranker (Improved CoT)
 * Uses keyword-based sorting for small sets, AI reranking for larger sets.
 */
async function rerankChunks(query: string, chunks: Chunk[]): Promise<Chunk[]> {
    if (chunks.length === 0) return [];

    // OPTIMIZATION: Use simple keyword sorting for very small chunk sets
    const SMART_RERANK_THRESHOLD = 10;

    if (chunks.length < SMART_RERANK_THRESHOLD) {
        console.log(`Small chunk set (${chunks.length}). Using keyword-based sorting only.`);
        return keywordBasedSort(query, chunks);
    }

    // Sort by keyword relevance FIRST
    const sortedCandidates = keywordBasedSort(query, chunks);

    // Filter Top 40 best matches for AI Reranking
    const candidates = sortedCandidates.slice(0, 40);

    console.log(`Large chunk set. AI reranking ${candidates.length} chunks...`);

    const prompt = `You are a Relevance Ranking Expert.
    Query: "${query}"
    
    Task: Rank the following document chunks based on their relevance to the query.
    
    <rules>
    1. **Exact Answer**: Give scores 9-10 to chunks that directly answer the specific question.
    2. **Context**: Give scores 6-8 to chunks that provide necessary background or partial answers.
    3. **Term Match**: Give scores 3-5 to chunks that share keywords but discuss different topics.
    4. **Irrelevant**: Give scores 0-2 to unrelated chunks.
    5. **Priority**: Boost "Regulation" and "Design Intent" documents by +1 point.
    </rules>
    
    Evaluate each chunk. Output JSON ONLY.
    format: {"scores": [{"id": "chunk_id", "score": 9, "thinking": "brief reasoning"}, ...]}
    
    Chunks:
    ${JSON.stringify(candidates.map(c => ({
        id: c.id,
        text: c.text.substring(0, 600), // Limit text size
        type: c.metadata.doc_type || "unknown"
    })))}
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

        // Filter out low relevance and Sort by score desc
        return scoredChunks
            .filter(c => (c.metadata.score || 0) >= 3)
            .sort((a, b) => (b.metadata.score || 0) - (a.metadata.score || 0));

    } catch (e) {
        console.error("Reranking failed, using original order:", e);
        return candidates; // Fallback
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
        // --- 0. Query Expansion & Routing ---
        // Parallel execution for speed
        const [expandedQueries, shouldWeb] = await Promise.all([
            generateSearchQueries(query),
            shouldTriggerWebSearch(query)
        ]);

        // Use a combined query for keyword matching (to catch synonyms)
        const enrichedQuery = expandedQueries.join(" ");
        console.log(`Enriched Query for Reranking: "${enrichedQuery}"`);

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

        // --- 2. Smart Evaluation & Web Search ---
        let webChunks: Chunk[] = [];
        let performWebSearch = shouldWeb;

        // If internal docs are missing, force search
        if (allChunks.length === 0) {
            performWebSearch = true;
            console.log("No internal documents found. Forcing Web Search.");
        }

        if (performWebSearch) {
            // Logic to inform user if we are searching for external info
            if (shouldWeb) {
                // If it was triggered by 'stock' or 'news', we don't necessarily apologize.
                answerText += "Retrieving latest information from the web...\n\n";
            } else {
                answerText += "Insufficient internal info. Searching the web...\n\n";
            }

            try {
                // Use the most specific expanded query if available, or original
                const searchQ = query;
                webChunks = await searchWeb(searchQ);
                console.log(`Web search returned ${webChunks.length} chunks.`);
                if (webChunks.length > 0) {
                    citations.push(...webChunks.map(c => c.metadata.source).filter((v, i, a) => a.indexOf(v) === i));
                }
            } catch (webError: any) {
                console.error("Web search failed:", webError);
                answerText += `(Web search unavailable: ${webError.message})\n\n`;
            }
        }

        // --- 3. Combine & Rerank ---
        const combinedChunks = [...allChunks, ...webChunks];

        if (combinedChunks.length === 0) {
            return {
                answer: "申し訳ございません。関連する情報が見つかりませんでした。\n\nもう少し具体的に質問していただけますか？",
                citations: []
            };
        }

        // Pass the ENRICHED query (synonyms) to the reranker for better keyword matching
        // The AI inside rerank might see the synonyms, which is helpful context
        let rankedChunks = await rerankChunks(enrichedQuery, combinedChunks);
        console.log(`Reranked ${rankedChunks.length} chunks.`);

        // --- Fallback Mechanism: Score Check ---
        const topScore = rankedChunks.length > 0 ? (rankedChunks[0].metadata.score || 0) : 0;
        // Threshold: 5.0 (AI "Context" is 6-8, "Term Match" is 3-5. Local sort: Heading is 5.0)
        // If the best match is weak, try Web Search if we haven't already
        const isRelevanceLow = topScore < 5.0;

        if (!performWebSearch && isRelevanceLow) {
            console.log(`Low relevance (Top Score: ${topScore}). Triggering Fallback Web Search.`);
            answerText += "Internal documents may not be sufficient. Checking the web...\n\n";

            try {
                // Use the original query for web search often works better than enriched for general topics
                const fallbackChunks = await searchWeb(query);
                if (fallbackChunks.length > 0) {
                    // Update citations
                    citations.push(...fallbackChunks.map(c => c.metadata.source).filter((v, i, a) => a.indexOf(v) === i));

                    // Combine and Re-rank again with the new chunks
                    const newCombined = [...combinedChunks, ...fallbackChunks];
                    rankedChunks = await rerankChunks(enrichedQuery, newCombined);
                    console.log(`Fallback Reranked ${rankedChunks.length} chunks.`);
                }
            } catch (webError: any) {
                console.warn("Fallback web search failed:", webError);
                answerText += `(Fallback search unavailable: ${webError.message})\n\n`;
            }
        }

        // --- 4. Build context for LLM ---
        const queryComplexity = query.split(/\s+/).filter(t => t.length > 0).length;
        const TOP_K = Math.min(10, Math.max(5, queryComplexity * 2));
        const topChunks = rankedChunks.slice(0, TOP_K);

        let context = "";
        topChunks.forEach((chunk, idx) => {
            const source = chunk.metadata.source || "Unknown";
            const heading = chunk.metadata.heading || "";
            const scoreStr = chunk.metadata.score !== undefined ? ` [Score: ${chunk.metadata.score.toFixed(2)}]` : "";
            context += `[${idx + 1}] (${source})${heading ? ` - ${heading}` : ""}${scoreStr}\n${chunk.text.trim()}\n\n`;
        });

        // --- 5. Generate Answer (Improved System Prompt) ---
        const systemPrompt = `You are a helpful design assistant for the Configurator Project.
Answering based on the provided context.

<instructions>
1. **Context First**: Answer based ONLY on the provided context documents.
2. **Prioritize Official Docs**: Trust "Regulation", "Merchandise Plan", and "Design Intent" documents over others.
3. **Handle Conflicts**: If Web Search results contradict Internal Documents regarding company specifics, trust Internal Documents. For general news/trends, trust Web Search.
4. **Source Authority**: Prioritize government (.go.jp), academic (.ac.jp), and official corporate websites. Treat unknown blogs or forums with skepticism.
5. **Citations**: Always cite sources using the [x] format locally within sentences.
5. **No Hallucination**: If the answer is not in the context, say "Provided documents do not contain this information".
6. **Thinking Process**: You MUST think step-by-step before answering. Wrap your thought process in <thinking> tags. This will not be shown to the user, but helps accuracy.
7. **Language**: Answer in Japanese efficiently and politely.
</instructions>

Format your response in markdown.`;

        const contextMessage = `Context Priority (Top to Bottom):
    ${context}`;

        console.log("Using Model ID: anthropic.claude-3-5-sonnet-20240620-v1:0");
        const modelId = "anthropic.claude-3-5-sonnet-20240620-v1:0";

        const payload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 3000,
            system: [
                {
                    type: "text",
                    text: systemPrompt + `
IMPORTANT: You MUST cite your sources using the reference numbers provided in the context (e.g., [1], [2]).
- When a sentence is based on a specific document, place the citation [x] at the end of that sentence.
- If multiple sources support a statement, use [1][2].
- Do not make up citations. Only use those provided in the context.

Response Format:
<answer>
Your clear, helpful answer in Japanese here, with [x] citations included in the text...
</answer>
`
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
            if (e.name === 'ThrottlingException' || e.$metadata?.httpStatusCode === 429) {
                answerText += `\n\n申し訳ございません。現在リクエストが集中しているため、少し時間をおいてから再度お試しください。\n`;
            } else {
                answerText += `\n\n回答の生成中にエラーが発生しました: ${e.message}\n`;
            }
        }

        // Append the reference list (mapping [1] -> Source)
        if (topChunks.length > 0) {
            answerText += `\n\n---\n**参考資料:**\n`;

            // Deduplicate sources but keep their indices
            const uniqueSources: string[] = [];
            // We want to list all context items available so the user knows what [1] refers to.
            // Or typically, we listing what was actually used is hard without parsing. 
            // Better to list the Top K items provided as context.

            topChunks.forEach((chunk, idx) => {
                const sourceName = chunk.metadata.source || "Unknown";
                const url = chunk.metadata.url;
                // If it's a web result, show URL
                const displaySource = url ? `${sourceName} (${url})` : sourceName;

                answerText += `[${idx + 1}] ${displaySource}\n`;
            });
        }

    } catch (error: any) {
        console.error("Handler error:", error);
        answerText = `System Error: ${error.message}`;
    }

    return {
        answer: answerText,
        citations: [] // Citations are now included in the answer text
    };
};


