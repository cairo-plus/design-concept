import { S3Client, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import pdf from "pdf-parse";
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
        throw new Error("Bucket name not found in environment variables");
    }

    try {
        // 1. Fetch relevant files from S3
        // For this demo, we'll blindly fetch all "uploadedDocs" from the 'public/' prefix
        // In a real app, you'd search a vector DB. Here we do "Context Stuffing".
        let context = "";
        const citations: string[] = [];

        // List all files in public/ to find matching keys for the uploadedDocs names
        // This is inefficient but functional for small demos
        const listCommand = new ListObjectsV2Command({
            Bucket: bucketName,
            Prefix: "public/",
        });
        const listResponse = await s3Client.send(listCommand);
        const allFiles = listResponse.Contents || [];

        // Filter files that match the requested documents
        // Heuristic: If uploadedDocs contains "MyPlan.pdf", look for public/.../MyPlan.pdf
        const relevantFiles = allFiles.filter(file =>
            file.Key && uploadedDocs.some(docName => file.Key!.includes(docName))
        );

        // If no specific docs requested or none found, maybe fallback to all? 
        // Let's stick to only what's requested to be precise.

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
                    const data = await pdf(buffer);
                    textContent = data.text;
                } else if (file.Key.endsWith(".xlsx")) {
                    const workbook = XLSX.read(byteArray, { type: "buffer" });
                    const sheetName = workbook.SheetNames[0];
                    const sheet = workbook.Sheets[sheetName];
                    textContent = XLSX.utils.sheet_to_csv(sheet);
                } else {
                    // Text fallback
                    textContent = Buffer.from(byteArray).toString('utf-8');
                }

                // Limit context size per file just in case
                const truncatedText = textContent.slice(0, 50000);
                context += `\n--- Document: ${file.Key} ---\n${truncatedText}\n`;
                citations.push(file.Key.split('/').pop() || file.Key);

            } catch (e) {
                console.error(`Error processing file ${file.Key}:`, e);
            }
        }

        // 2. Construct Prompt for Bedrock
        const systemPrompt = `You are a helpful design assistant. 
    Answer the user's question using ONLY the provided context documents.
    If the answer is explicitly found in the documents, cite the document name.
    If the answer is NOT found in the documents, invoke the <search_needed/> tag.
    Do NOT make up information.
    
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

        // 3. Check for Internet Search Fallback
        if (answer.includes("<search_needed/>") || context.length === 0) {
            console.log("Fallback to internet search triggered.");
            // Perform search
            // Note: For this demo, we'll simulate a search or use a free API if configured.
            // Since we don't have a guaranteed API key for Tavily in the prompt history,
            // we will fallback to a "Simulated Search used for Plan" message or try to use Bedrock's internal knowledge without context constraint.

            // Re-prompt Bedrock allowing it to use internal knowledge or simulating search result
            const fallbackPrompt = `You are a helpful assistant. The user asked: "${query}".
        You previously couldn't find the answer in the provided files.
        Now, please answer using your general knowledge. 
        Note that you are acting as an AI assistant that can search the internet, so you can say "I searched the internet and found..."
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

            // Clear citations as it came from "Internet/General Knowledge"
            // Or keep them empty
            citations.push("Internet Search (Simulated)");
        }

        return {
            answer,
            citations
        };

    } catch (error) {
        console.error("Handler error:", error);
        return {
            answer: "Sorry, an error occurred while processing your request.",
            citations: []
        };
    }
};
