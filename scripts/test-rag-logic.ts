
import { strict as assert } from 'assert';

// --- Mock Interfaces ---
interface ChunkMetadata {
    source: string;
    doc_type?: string;
    heading?: string;
    score?: number;
    [key: string]: any;
}

interface Chunk {
    id: string;
    text: string;
    metadata: ChunkMetadata;
}

const PRIORITY_ORDER = [
    "past_design_intent", // 設計構想書
    "merchandise_plan", // 商品計画書
    "product_plan", // 製品企画書
    "regulation", // 法規リスト
];

// --- Logic to Test (Exact copy from handler.ts) ---

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

// --- Test Cases ---

function runTests() {
    console.log("Running RAG Logic Tests...");

    const mockChunks: Chunk[] = [
        { id: "1", text: "This is a random text about nothing.", metadata: { source: "random.txt", doc_type: "other" } },
        { id: "2", text: "The target market for the new SUV is young families.", metadata: { source: "plan.md", doc_type: "merchandise_plan" } },
        { id: "3", text: "Regulation 55 requires specific brake performance.", metadata: { source: "reg.md", doc_type: "regulation" } },
        { id: "4", text: "Design Concept: Aerodynamic efficiency is key.", metadata: { source: "concept.md", doc_type: "past_design_intent" } },
        { id: "5", text: "Old report from 2020.", metadata: { source: "old.md", doc_type: "other" } },
        { id: "6", text: "Latest market trends for 2025 show EV growth.", metadata: { source: "trend.md", doc_type: "merchandise_plan" } },
    ];

    // Test 1: Doc Type Priority
    console.log("\nTest 1: Doc Type Priority");
    const res1 = keywordBasedSort("market", mockChunks);

    // Debug output
    res1.forEach(c => console.log(`ID: ${c.id}, Score: ${c.metadata.score}, Type: ${c.metadata.doc_type}`));

    assert.equal(res1[0].id, "2", "Should prioritize merchandise_plan for 'market'");

    // Test 2: Heading Match
    console.log("\nTest 2: Heading Match");
    const headingChunk = { id: "h1", text: "content", metadata: { source: "h.md", heading: "Brake Performance" } };
    const bodyChunk = { id: "b1", text: "brake performance content", metadata: { source: "b.md" } };
    const res2 = keywordBasedSort("brake", [headingChunk, bodyChunk]);

    // Debug output
    res2.forEach(c => console.log(`ID: ${c.id}, Score: ${c.metadata.score}`));

    // Heading Score:
    // Body: "content" has 0 "brake".
    // Heading: "Brake Performance" has 1 "brake" * 3.0 = 3.0.
    // Phrase: "content" != "brake".
    // Total = 3.0

    // Body Score:
    // Body: "brake performance content" has 1 "brake" * 1.0 = 1.0.
    // Heading: None.
    // Phrase: "brake performance content" != "brake".
    // Total = 1.0

    assert.equal(res2[0].id, "h1", "Heading match should score higher");

    // Test 3: Recency
    console.log("\nTest 3: Recency Logic");
    const res3 = keywordBasedSort("latest market", mockChunks);

    // Debug output
    res3.forEach(c => console.log(`ID: ${c.id}, Score: ${c.metadata.score}`));

    // Chunk 6 has "market" (doc type priority) AND "2025" (recency check because query has "latest")
    assert.equal(res3[0].id, "6", "Should prioritize 2025 content for 'latest' query");

    console.log("\nAll tests passed!");
}

runTests();
