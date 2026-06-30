import { GoogleGenAI } from "@google/genai";

async function test() {
  console.log("Initializing client with an invalid/mock key...");
  const ai = new GoogleGenAI({ apiKey: "INVALID_MOCK_KEY" });
  const start = Date.now();
  
  try {
    console.log("Calling generateContent with minimal prompt...");
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", // Using standard model
      contents: "Hello, reply with single word 'Hi'."
    });
    console.log(`Success in ${Date.now() - start}ms:`, response.text);
  } catch (error: any) {
    console.log(`Error caught as expected after ${Date.now() - start}ms:`, error.message || error);
  }
}

test();
