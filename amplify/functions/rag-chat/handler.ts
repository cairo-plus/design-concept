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


export const handler = awslambda.streamifyResponse(async (event: any, responseStream: any, context: any) => {
    console.log("Received event:", JSON.stringify(event));

    // Handle both AppSync arguments and Function URL body
    let query = "";
    let uploadedDocs: string[] = [];

    if (event.arguments) {
        query = event.arguments.query;
        uploadedDocs = event.arguments.uploadedDocs || [];
    } else if (event.body) {
        try {
            const body = JSON.parse(event.body);
            query = body.query;
            uploadedDocs = body.uploadedDocs || [];
        } catch (e) {
            console.error("Failed to parse body", e);
        }
    }

    // Prepare Response Stream (Headers)
    // Note: Function URL might need explicit content type
    // responseStream = awslambda.HttpResponseStream.from(responseStream, {
    //     statusCode: 200,
    //     headers: { "Content-Type": "text/plain" }
    // }); 
    // Usually standard stream writes are fine for simple text, but let's be safe if we can.
    // However, simpler is better for now: just write strings.

    const bucketName = process.env.BUCKET_NAME;

    if (!bucketName) {
        responseStream.write("Configuration Error: BUCKET_NAME is missing.");
        responseStream.end();
        return;
    }

    try {
        // --- 1. Fetch chunks from S3 ---
        // Parallelize S3 fetches for speed
        const targetKeys = uploadedDocs.map((path) => {
            let target = path.replace("public/", "protected/");
            const lastDotIndex = target.lastIndexOf(".");
            if (lastDotIndex !== -1) {
                target = target.substring(0, lastDotIndex);
            }
            return target + "_chunks.json";
        });

        const citations: string[] = [];
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

        s3Results.forEach(res => {
            if (res) {
                if (Array.isArray(res.chunks)) allChunks.push(...res.chunks);
                if (!citations.includes(res.fileName)) citations.push(res.fileName);
            }
        });

        // --- 2. Evaluate & Conditional Web Search (CRAG) ---
        let webChunks: Chunk[] = [];

        // Always search if no S3 docs found
        let shouldSearchWeb = allChunks.length === 0;
        let evalReason = "No internal documents found.";

        if (!shouldSearchWeb) {
            // Evaluate internal docs
            responseStream.write("Evaluating internal documents...\n"); // User feedback
            const evaluation = await evaluateRetrieval(query, allChunks);
            shouldSearchWeb = !evaluation.sufficient;
            evalReason = evaluation.reason;
            console.log(`Evaluation: Sufficient=${evaluation.sufficient}, Reason=${evaluation.reason}`);
        }

        if (shouldSearchWeb) {
            responseStream.write("Insufficient information found. Searching the web...\n");
            webChunks = await searchWeb(query);
            allChunks.push(...webChunks);

            webChunks.forEach(wc => {
                if (wc.metadata.url && !citations.includes(`Web: ${wc.metadata.heading}`)) {
                    citations.push(`[${wc.metadata.heading}](${wc.metadata.url})`);
                }
            });
        } else {
            responseStream.write("Sufficient information found in internal documents.\n");
        }

        // --- 3. Reranking ---
        // Optimization: Filter by keyword overlap BEFORE sending to Reranker to support larger document sets
        // Simple Set-based keyword match for pre-filtering
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);

        let preFilteredChunks = allChunks;
        if (allChunks.length > 100) {
            // Pre-rank by simple keyword density
            preFilteredChunks = allChunks.map(c => {
                let overlap = 0;
                const textLower = c.text.toLowerCase();
                queryTerms.forEach(t => { if (textLower.includes(t)) overlap++; });
                return { ...c, metadata: { ...c.metadata, simple_score: overlap } };
            })
                .sort((a, b) => b.metadata.simple_score - a.metadata.simple_score)
                .slice(0, 100); // Take top 100 for AI reranking
        }

        let rankedChunks = await rerankChunks(query, preFilteredChunks);

        if (rankedChunks.length === 0 && allChunks.length > 0) {
            console.log("Reranking removed all chunks, recovering top original chunks.");
            rankedChunks = allChunks.slice(0, 20);
        }

        // --- 4. Construct Context ---
        let context = "";
        const MAX_CONTEXT_LENGTH = 150000;

        for (const chunk of rankedChunks) {
            if (context.length > MAX_CONTEXT_LENGTH) break;
            const docType = chunk.metadata.doc_type || "other";
            const docLabel = DOC_TYPE_LABELS[docType] || "Other Documents";
            const header = chunk.metadata.heading ? `[Heading: ${chunk.metadata.heading}]` : "";
            const source = chunk.metadata.source ? `(Source: ${chunk.metadata.source})` : "";
            const score = chunk.metadata.score ? `(Relevance: ${chunk.metadata.score}/10)` : "";
            context += `\n=== SOURCE: ${docLabel} ${score} ===\n${header} ${source}\n${chunk.text}\n`;
        }

        if (!context) context = "No relevant documents found.";

        // --- 5. Generate with Streaming ---
        const systemPrompt = `You are a sophisticated Design Assistant (設計アシスタント). 
    Answer the user's question using the provided context documents.
    
    ## Thinking Process
    1. Identify the core question and any specific constraints.
    2. Scan the provided context for relevant keywords.
    3. Evaluate reliability and priority. **Web Search results are highly reliable for latest trends/news (2024-2025).**
    4. Formulate your answer based ONLY on the evidence.
    
    ## Citation Rules
    - Prioritize: Web Search > Design Concept > Merchandise Plan > Product Plan > Regulation.
    - Explicitly mention document types.
    
    Current Date: ${new Date().toISOString()}`;

        const userMessage = `Context Priority (Top to Bottom):
    ${context}
    
    Question: ${query}`;

        const modelId = "us.anthropic.claude-3-5-sonnet-20241022-v2:0";

        const payload = {
            anthropic_version: "bedrock-2023-05-31",
            max_tokens: 3000,
            system: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
        };

        const streamCommand = new InvokeModelWithResponseStreamCommand({
            modelId,
            contentType: "application/json",
            accept: "application/json",
            body: JSON.stringify(payload),
        });

        // Send thinking message if possible? 
        // No, standard text stream. The client will see it arrive.
        // responseStream.write("Thinking...\n"); // Optional

        try {
            const response = await bedrockClient.send(streamCommand);

            if (response.body) {
                for await (const chunk of response.body) {
                    if (chunk.chunk && chunk.chunk.bytes) {
                        const decoded = new TextDecoder().decode(chunk.chunk.bytes);
                        const parsed = JSON.parse(decoded);
                        if (parsed.type === "content_block_delta" && parsed.delta && parsed.delta.text) {
                            responseStream.write(parsed.delta.text);
                        }
                    }
                }
            }
        } catch (e: any) {
            console.error("Bedrock Stream Error:", e);
            // Fallback to standard invoke if stream fails (omitted for brevity, assume stream works)
            responseStream.write(`\n(Error generating response: ${e.message})\n`);
        }

        // Append Citations
        if (citations.length > 0) {
            responseStream.write(`\n\n---\n**参考資料:**\n`);
            citations.forEach(c => responseStream.write(`- ${c}\n`));
        }

    } catch (error: any) {
        console.error("Handler error:", error);
        responseStream.write(`System Error: ${error.message}`);
    } finally {
        responseStream.end();
    }
});
