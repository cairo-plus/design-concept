import { defineFunction } from "@aws-amplify/backend";
import { Function, Runtime, Code } from "aws-cdk-lib/aws-lambda";
import { Duration } from "aws-cdk-lib";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const chunkDocuments = defineFunction((scope) => {
    return new Function(scope, "ChunkDocumentsFunction", {
        runtime: Runtime.PYTHON_3_12,
        handler: "handler.handler",
        code: Code.fromAsset(__dirname),
        timeout: Duration.minutes(5),
        memorySize: 512,
    });
});
