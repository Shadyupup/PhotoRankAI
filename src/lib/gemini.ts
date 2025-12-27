import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";

const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(API_KEY);

const schema = {
    description: "Aesthetic score and reasoning for a photo",
    type: SchemaType.OBJECT,
    properties: {
        score: {
            type: SchemaType.NUMBER,
            description: "Aesthetic score from 1.0 to 10.0",
            nullable: false,
        },
        reason: {
            type: SchemaType.STRING,
            description: "Concise reason for the score (max 15 words). Focus on composition, lighting, and sharpness.",
            nullable: false,
        },
    },
    required: ["score", "reason"],
} as any;

const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: {
        responseMimeType: "application/json",
        responseSchema: schema,
    },
});

export async function analyzePhoto(blob: Blob): Promise<{ score: number; reason: string }> {
    if (!API_KEY) throw new Error("API Key not found");

    const base64Data = await blobToBase64(blob);

    const result = await model.generateContent([
        "Analyze the aesthetic quality of this photo for a professional photographer. strictly follow the JSON schema.",
        {
            inlineData: {
                data: base64Data,
                mimeType: "image/jpeg",
            },
        },
    ]);

    const text = result.response.text();
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse JSON", text);
        return { score: 0, reason: "Analysis failed to parse" };
    }
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            const base64 = dataUrl.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
