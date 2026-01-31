import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

// Get current directory
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const outputsPath = path.join(rootDir, "amplify_outputs.json");
const testDataDir = path.join(rootDir, "test-data");

async function main() {
    if (!fs.existsSync(outputsPath)) {
        console.error("amplify_outputs.json not found!");
        process.exit(1);
    }

    const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf-8"));
    const bucketName = outputs.storage.bucket_name;
    const region = outputs.storage.aws_region;

    console.log(`Using Bucket: ${bucketName} in ${region}`);

    // Using default credential provider chain (env vars, profile, etc.)
    const client = new S3Client({ region });

    if (!fs.existsSync(testDataDir)) {
        console.error(`Test data directory not found at ${testDataDir}`);
        process.exit(1);
    }

    const files = fs.readdirSync(testDataDir).filter(f => f.endsWith(".md"));

    if (files.length === 0) {
        console.warn("No markdown files found in test-data directory.");
        return;
    }

    for (const file of files) {
        const content = fs.readFileSync(path.join(testDataDir, file));
        // Based on backend.ts: bucket.addEventNotification(..., { prefix: 'protected/', suffix: '.md' }) -> chunkDocuments
        const key = `protected/${file}`;

        console.log(`Uploading ${file} to s3://${bucketName}/${key}...`);
        try {
            await client.send(new PutObjectCommand({
                Bucket: bucketName,
                Key: key,
                Body: content
            }));
            console.log("Success!");
        } catch (e) {
            console.error("Upload failed:", e);
        }
    }
}

main().catch(console.error);
