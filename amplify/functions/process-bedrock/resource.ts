import { defineFunction } from "@aws-amplify/backend";

import { DockerImageFunction, DockerImageCode } from "aws-cdk-lib/aws-lambda";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cdk from "aws-cdk-lib";
import { Duration } from "aws-cdk-lib";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const processBedrock = defineFunction((scope) => {
    return new DockerImageFunction(scope, "ProcessBedrockFunction", {
        code: DockerImageCode.fromImageAsset(path.join(__dirname, "."), {
            platform: Platform.LINUX_AMD64,
        }),
        timeout: Duration.minutes(15),
        memorySize: 1024,
        logGroup: new logs.LogGroup(scope, "ProcessBedrockLogGroup", {
            retention: logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY
        }),
        environment: {
            // Tokyo Region Sonnet 3.5
            BEDROCK_MODEL_ID: "anthropic.claude-3-5-sonnet-20240620-v1:0"
        }
    });
}, {
    resourceGroupName: "storage"
});
