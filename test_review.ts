import { generateCodeReview } from "./services/geminiService";
import { ModelTier } from "./types";

// Mock Pull Request
const mockPr = {
  number: 1,
  title: "Add hello world message",
  body: "This PR introduces a hello world console.log statements to test output.",
  head: {
    ref: "feature/test",
    sha: "123456abcdef"
  },
  base: {
    ref: "main"
  },
  labels: [],
  testStatus: "unknown" as const,
  isBig: false,
  isReadyToMerge: false,
  isLeaderBranch: false,
  isApproved: false
};

const mockDiff = `diff --git a/src/index.ts b/src/index.ts
index 0000000..1111111 100644
--- a/src/index.ts
+++ b/src/index.ts
@@ -1,3 +1,3 @@
-console.log("old content");
+console.log("hello world from a technical audit test");
+console.log("additional line of code for testing purpose");`;

async function test() {
  console.log("[Test] Start");
  
  try {
    console.log("[Test] Calling generateCodeReview...");
    const start = Date.now();
    const result = await generateCodeReview(mockPr as any, mockDiff, { modelTier: ModelTier.FLASH });
    console.log(`[Test] Success in ${Date.now() - start}ms!`);
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (error: any) {
    console.error("[Test] CATCH ERROR:");
    console.error(error.message || error);
  }
}

test();
