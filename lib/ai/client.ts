import OpenAI from "openai";

export const aiClient = new OpenAI({
  apiKey: process.env.CLOD_API_KEY!,
  baseURL: process.env.CLOD_BASE_URL!
});

export const AI_MODEL = process.env.CLOD_MODEL!;
