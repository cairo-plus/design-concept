import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
// Robust import for pdf-parse (handles CJS/ESM interop issues)
import * as pdfLib from "pdf-parse";
const pdf = (pdfLib as any).default || pdfLib;

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
        // 1. Fetch relevant files from S3
        let context = "";
        const citations: string[] = [];
        const debugLogs: string[] = [];

        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: "public/",
        });
        const listResponse = await s3Client.send(listCommand);
        const allFiles = listResponse.Contents || [];

        const relevantFiles = allFiles.filter(file =>
            file.Key && uploadedDocs.some(docName => file.Key!.includes(docName))
        );

        console.log(`Found ${relevantFiles.length} relevant files in S3.`);

        for (const file of relevantFiles) {
            if (!file.Key) continue;

            try {
                console.log(`Processing file: ${file.Key}`);
                const getCommand = new GetObjectCommand({
                    Bucket: bucketName,
                    Key: file.Key,
                });
                const response = await s3Client.send(getCommand);

                if (!response.Body) continue;

                const byteArray = await response.Body.transformToByteArray();
                let textContent = "";

                if (file.Key.endsWith(".pdf")) {
                    const buffer = Buffer.from(byteArray);
                    // Use the robust pdf function
                    try {
                        const data = await pdf(buffer);
                        textContent = data.text;
                    } catch (parseError: any) {
                        console.error("PDF Parse Error:", parseError);
                        debugLogs.push(`Failed to parse ${file.Key}: ${parseError.message}`);
                        continue;
                    }
                } else if (file.Key.endsWith(".xlsx")) {
                    const workbook = XLSX.read(byteArray, { type: "buffer" });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    textContent = XLSX.utils.sheet_to_csv(sheet);
                } else {
                    // Text fallback
                    textContent = Buffer.from(byteArray).toString('utf-8');
                }

                const truncatedText = textContent.slice(0, 50000);
                context += `\n--- Document: ${file.Key} ---\n${truncatedText}\n`;
                citations.push(file.Key.split('/').pop() || file.Key);

            } catch (e: any) {
                console.error(`Error processing file ${file.Key}:`, e);
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
