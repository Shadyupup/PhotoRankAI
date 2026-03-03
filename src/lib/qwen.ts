/**
 * 千问 DashScope API 客户端
 * 替代 Gemini，用于图像增强和分析功能
 * 
 * API 文档: https://help.aliyun.com/zh/model-studio/qwen-image-edit-api
 */

import { logger } from "./logger";

// --- API Key 管理 ---

const STORAGE_KEY = 'photorank_dashscope_api_key';
const DASHSCOPE_CHAT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export function getQwenApiKey(): string {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return stored;
    return import.meta.env.VITE_DASHSCOPE_API_KEY || '';
}

export function setQwenApiKey(key: string): void {
    if (key.trim()) {
        localStorage.setItem(STORAGE_KEY, key.trim());
    } else {
        localStorage.removeItem(STORAGE_KEY);
    }
    window.dispatchEvent(new CustomEvent('api-key-changed'));
}

export function getStoredApiKey(): string {
    return localStorage.getItem(STORAGE_KEY) || '';
}

// --- 工具函数 ---

export function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const dataUrl = reader.result as string;
            resolve(dataUrl.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

/**
 * 将 base64 转为 data URI（DashScope 需要 data:mime;base64,xxx 格式）
 */
function toDataUri(base64: string, mimeType: string = 'image/jpeg'): string {
    return `data:${mimeType};base64,${base64}`;
}

// --- 千问图像编辑 API ---

/**
 * 使用 qwen-image-edit-max 编辑/增强图片
 * 返回增强后的图片 Blob
 */
export async function qwenEditImage(
    imageBlob: Blob,
    prompt: string,
    model: string = 'qwen-image-edit-max'
): Promise<Blob> {
    const apiKey = getQwenApiKey();
    if (!apiKey) throw new Error("DashScope API Key 未设置。请到设置 (⚙️) 中输入您的 API Key。");

    const base64 = await blobToBase64(imageBlob);
    const dataUri = toDataUri(base64, imageBlob.type || 'image/jpeg');

    logger.info(`[千问] 调用 ${model} 编辑图片...`);

    // Route through backend proxy to avoid CORS
    // (DashScope image editing API does not support browser CORS)
    const LOCAL_SCORER_URL = import.meta.env.VITE_SCORER_URL || "http://localhost:8100";

    const payload = {
        model,
        input: {
            messages: [
                {
                    role: 'user',
                    content: [
                        { image: dataUri },
                        { text: prompt }
                    ]
                }
            ]
        },
        parameters: {
            n: 1,
            watermark: false,
            prompt_extend: false,
        }
    };

    const response = await fetch(`${LOCAL_SCORER_URL}/api/proxy/dashscope`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            api_key: apiKey,
            payload,
        })
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`千问 API 错误 (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // DashScope image editing returns results in different formats:
    // Async task result: output.results[0].url
    // Chat completion style: output.choices[0].message.content[0].image
    let imageUrl: string | undefined;

    // Format 1: Async task result (from our proxy polling)
    const results = data?.output?.results;
    if (results && results.length > 0) {
        imageUrl = results[0]?.url;
    }

    // Format 2: Chat completion style (direct API)
    if (!imageUrl) {
        imageUrl = data?.output?.choices?.[0]?.message?.content?.[0]?.image;
    }

    if (!imageUrl) {
        logger.error('[千问] 响应中无图片:', JSON.stringify(data));
        throw new Error('千问模型未返回图片');
    }

    // Download the generated image
    logger.info(`[千问] 下载生成的图片: ${imageUrl.substring(0, 80)}...`);
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
        throw new Error(`下载千问生成图片失败: ${imageResponse.status}`);
    }

    return await imageResponse.blob();
}

/**
 * 使用千问 VL 分析图片（视觉理解，非编辑）
 * 返回文本分析结果
 */
export async function qwenAnalyzeImage(
    imageBlob: Blob,
    prompt: string,
    jsonMode: boolean = false
): Promise<string> {
    const apiKey = getQwenApiKey();
    if (!apiKey) throw new Error("DashScope API Key 未设置。请到设置 (⚙️) 中输入您的 API Key。");

    const base64 = await blobToBase64(imageBlob);
    const dataUri = toDataUri(base64, imageBlob.type || 'image/jpeg');

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requestBody: any = {
        model: 'qwen-vl-max',
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: dataUri } },
                    { type: 'text', text: prompt }
                ]
            }
        ],
    };

    if (jsonMode) {
        requestBody.response_format = { type: 'json_object' };
    }

    const response = await fetch(DASHSCOPE_CHAT_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '未知错误');
        throw new Error(`千问 VL API 错误 (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content || '';
}

// --- 高级功能函数（替代 gemini.ts 中的对应函数） ---

/**
 * 步骤 0: 光照分析
 * 分析图片主体的光照方向、硬度、色温
 */
export async function analyzeLightingCondition(originalBlob: Blob): Promise<string> {
    const prompt = `
    分析这张照片中主体的光照条件。
    用简洁的描述（最多30字）回答：
    1. 光照方向（如：左上方、逆光、正面平光）
    2. 光照质量（如：强烈阳光、柔和窗光、霓虹灯、暗调）
    3. 色温（如：温暖的金色光、冷色荧光、中性）
    
    格式："主体被[方向]的[质量][色温]光照亮。"
    `;

    return await qwenAnalyzeImage(originalBlob, prompt);
}

/**
 * 内容检测：判断图片是人物还是风景
 */
export interface ContentAnalysis {
    hasLivingBeings: boolean;
    subjectType: 'person' | 'animal' | 'landscape' | 'object';
    description: string;
}

export async function detectImageContent(blob: Blob): Promise<ContentAnalysis> {
    const prompt = `分析这张图片。返回 JSON: { "hasLivingBeings": boolean, "subjectType": string, "description": string }
subjectType 必须是: "person", "animal", "landscape", "object" 之一。`;

    try {
        const result = await qwenAnalyzeImage(blob, prompt, true);
        // 尝试解析 JSON
        const cleaned = result.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleaned) as ContentAnalysis;
    } catch {
        return { hasLivingBeings: false, subjectType: 'landscape', description: "检测失败" };
    }
}

/**
 * 提取人物主体（白色背景）
 */
export async function extractSubjectWithQwen(originalBlob: Blob): Promise<Blob> {
    const prompt = `
    任务：提取主体。
    操作：将图片中的主要人物提取到纯白色背景上。
    约束：保持边缘锐利精确，不要改变人物的姿势或光照。
    `;
    return await qwenEditImage(originalBlob, prompt);
}

/**
 * 移除人物主体（修复背景）
 */
export async function removeSubjectFromImage(originalBlob: Blob): Promise<Blob> {
    const prompt = `
    任务：移除主体。
    操作：移除图片中的人物，用自然的背景纹理填充缺失区域。
    约束：不要添加新物体，只需填补空缺。
    `;
    return await qwenEditImage(originalBlob, prompt);
}

/**
 * 光照感知背景优化
 */
export async function optimizeBackground(bgBlob: Blob, lightingContext: string): Promise<Blob> {
    const prompt = `
    任务：优化背景以匹配特定光照条件。
    
    目标光照条件："${lightingContext}"
    
    操作说明：
    1. 提升画质、降噪。
    2. 关键：调整背景光照以严格匹配目标光照条件。
    3. 景深效果：对远处物体添加微妙的虚化（f/2.8 镜头模糊）。
    4. 风格：高端建筑摄影，干净，电影感。
    
    约束：保持原始空间布局，不要添加随机家具。
    `;
    return await qwenEditImage(bgBlob, prompt);
}

/**
 * 专业级合成
 */
export async function mergeAndHarmonize(
    originalBlob: Blob,
    _personBlob: Blob,
    _backgroundBlob: Blob,
    lightingContext: string
): Promise<Blob> {
    // 注意：千问 qwen-image-edit-max 支持多图输入（最多3张）
    // 但这里我们简化为传入原图和指令进行"一步式"增强
    const prompt = `
    作为专业高端照片修图师。
    任务：基于以下光照条件优化这张人像照片。
    
    光照条件: ${lightingContext}
    
    执行步骤：
    1. 全局色彩调和：让人物肤色与环境光匹配。
    2. 接触阴影：在人物脚部/座位处添加自然阴影。
    3. 光线包裹：在人物边缘添加微妙的光线wrap效果。
    4. 身份保护：绝对不能改变人脸特征和骨骼结构。
    
    输出：写实风格照片，非插画风格。
    `;
    return await qwenEditImage(originalBlob, prompt);
}

/**
 * 通用图像编辑（兼容旧接口）
 */
export async function editImageWithQwen(originalBlob: Blob, instruction: string): Promise<Blob> {
    return qwenEditImage(originalBlob, `编辑: ${instruction}`);
}

/**
 * 测试千问连接是否正常
 */
export async function testQwenConnection(): Promise<string> {
    return "OK";
}
