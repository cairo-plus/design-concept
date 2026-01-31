import { S3Client, ListObjectsV2Command } from "@aws-sdk/client-s3";
import * as fs from "fs";
import * as path from "path";
import * as url from "url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");
const outputsPath = path.join(rootDir, "amplify_outputs.json");

async function main() {
    if (!fs.existsSync(outputsPath)) {
        console.error("amplify_outputs.json not found!");
        process.exit(1);
    }

    const outputs = JSON.parse(fs.readFileSync(outputsPath, "utf-8"));
    const bucketName = outputs.storage.bucket_name;
    const region = outputs.storage.aws_region;

    console.log(`Using Bucket: ${bucketName} in ${region}`);
    const client = new S3Client({ region });

    const command = new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: "protected/"
    });

    try {
        const response = await client.send(command);
        console.log("Files in S3 (protected/):");
        const contents = response.Contents || [];
        contents.forEach(c => console.log(` - ${c.Key} (${c.Size} bytes)`));

        const chunkFiles = contents.filter(c => c.Key?.endsWith("_chunks.json"));
        if (chunkFiles.length > 0) {
            console.log("\nSUCCESS: Found generated chunk files!");
            chunkFiles.forEach(c => console.log(`   * ${c.Key}`));
        } else {
            console.log("\nWARNING: No chunk files found yet. Processing might be lagging or failed.");
        }
    } catch (e) {
        console.error("List failed:", e);
    }
}

main().catch(console.error);
