import "./polyfill"; // Must be imported first to ensure DOMMatrix is defined
import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
// Robust import for pdf-parse using createRequire to ensure it loads AFTER polyfill
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfLib = require("pdf-parse");
const pdf = pdfLib.default || pdfLib;

import * as XLSX from "xlsx";
import axios from "axios";

// Clients
const s3Client = new S3Client({});
const bedrockClient = new BedrockRuntimeClient({});

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
        // 1. Fetch relevant files using chunks
        let context = "";
        const citations: string[] = [];
        const debugLogs: string[] = [];

        // We look in "protected/" for processed files (chunks.json)
        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: "protected/",
        });
        const listResponse = await s3Client.send(listCommand);
        const allFiles = listResponse.Contents || [];

        // Filter for files directly matching the uploaded docs but with _chunks.json suffix
        // The structure is protected/{docType}/{timestamp}/{filename}_chunks.json
        // But uploadedDocs provides the filename (e.g., "A.pdf").
        // We need to match if the S3 key *contains* the filename + "_chunks.json" inside.

        const relevantFiles = allFiles.filter(file => {
            if (!file.Key || !file.Key.endsWith("_chunks.json")) return false;

            // Check if any uploaded doc name matches the key
            // Example: file.Key = "protected/Plan/TIME/MyDoc_chunks.json"
            // uploadedDoc = "MyDoc.pdf" -> we match "MyDoc"

            return uploadedDocs.some(docName => {
                // Remove extension to match base name
                const baseName = docName.substring(0, docName.lastIndexOf('.')) || docName;
                return file.Key!.includes(baseName);
            });
        });

        console.log(`Found ${relevantFiles.length} processed chunk files in S3 (protected/).`);

        for (const file of relevantFiles) {
            if (!file.Key) continue;

            try {
                console.log(`Processing chunk file: ${file.Key}`);
                const getCommand = new GetObjectCommand({
                    Bucket: bucketName,
                    Key: file.Key,
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
                context += `\n--- Document: ${file.Key} ---\n${truncatedText}\n`;

                // Citation logic: extract original filename from Key or use Key
                const citationName = file.Key.split('/').pop()?.replace('_chunks.json', '') || file.Key;
                citations.push(citationName);

            } catch (e: any) {
                console.error(`Error processing chunk file ${file.Key}:`, e);
                debugLogs.push(`Error reading ${file.Key}: ${e.message}`);
            }
        }

        // 2. Construct Prompt for Bedrock
        const systemPrompt = `You are a helpful design assistant. 
    Answer the user's question using ONLY the provided context documents.
    If the answer is explicitly found in the documents, cite the document name.
    If the answer is NOT found in the documents, and context was provided, invoke the <search_needed/> tag.
    If NO context was provided, answer from your general knowledge but mention that no documents were found.
    
    Current Date: ${new Date().toISOString()}
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

        const bedrockResponse = await bedrockClient.send(invokeCommand);
        const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body));
        let answer = responseBody.content[0].text;

        // 3. Fallback / "Internet Search" Simulation
        // If the model says search is needed, we interpret that as "Not in docs".
        // Since we don't have a real search API hooked up, we fall back to internal knowledge.
        if (answer.includes("<search_needed/>")) {
            console.log("Fallback to general knowledge triggered.");

            const fallbackPrompt = `You are a helpful assistant. The user asked: "${query}".
        You previously couldn't find the answer in the provided files.
        Please answer using your general knowledge.
        IMPORTANT: Start your response with "【ウェブ検索（シミュレーション）】" to indicate this is general knowledge, not from the files.
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

            // Clear file citations, add simulation note
            citations.splice(0, citations.length);
            citations.push("General Knowledge (No matching file content)");
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
