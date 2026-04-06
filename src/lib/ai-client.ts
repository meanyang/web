export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_RESUME_MODEL = process.env.OPENROUTER_RESUME_MODEL ?? "minimax/minimax-m2.5:free";
export const OPENROUTER_GREETING_MODEL = process.env.OPENROUTER_GREETING_MODEL ?? "qwen/qwen3.6-plus:free";

export type HrPersona = "A" | "B" | "C";

type OpenAIMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "system" | "user" | "assistant";
      content: Array<
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
        | { type: "file"; file: { filename: string; file_data?: string; fileData?: string } }
      >;
    };

function requiredHeaders() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("缺少 OPENROUTER_API_KEY");

  const envReferer =
    process.env.OPENROUTER_HTTP_REFERER ??
    process.env.OPENROUTER_SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const httpReferer = envReferer?.startsWith("http") ? envReferer : envReferer ? `https://${envReferer}` : undefined;

  return {
    authorization: `Bearer ${apiKey}`,
    "http-referer": httpReferer ?? "http://localhost:3000",
    "x-openrouter-title": process.env.OPENROUTER_TITLE ?? "Recruit-Copilot",
  } as const;
}

async function openrouterFetch(path: string, init: RequestInit) {
  const url = `${OPENROUTER_BASE_URL}${path}`;
  const headers = {
    ...requiredHeaders(),
    ...(init.headers ?? {}),
  };
  return fetch(url, { ...init, headers });
}

function tryParseJson(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("模型返回内容不是有效 JSON");
  }
}

export async function chatCompletion(params: {
  messages: OpenAIMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseJson?: boolean;
  plugins?: unknown[];
}) {
  const resp = await openrouterFetch("/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: params.model ?? OPENROUTER_GREETING_MODEL,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.maxTokens ?? 800,
      ...(params.responseJson ? { response_format: { type: "json_object" } } : {}),
      ...(params.plugins ? { plugins: params.plugins } : {}),
      stream: false,
    }),
  });

  if (resp.status === 429) {
    throw Object.assign(new Error("免费通道繁忙，请 5 秒后重试"), { status: 429 });
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw Object.assign(
      new Error(`OpenRouter 请求失败：${resp.status} ${resp.statusText}${t ? ` - ${t}` : ""}`),
      { status: resp.status },
    );
  }

  const data = await resp.json();
  const content = (data?.choices?.[0]?.message?.content ?? "").toString();
  return content.trim();
}

export async function parseResumeFromText(params: { resumeText: string }) {
  const system = [
    "你是简历解析器。用户会提供从简历 PDF 提取的纯文本。",
    "请从文本中提取结构化信息，并只输出 JSON，不要输出任何解释、Markdown 或代码块。",
    "",
    "JSON Schema（严格遵守）：",
    "{",
    '  "coreSkills": string[],',
    '  "projectExperienceSummary": string,',
    '  "keyAchievements": string[],',
    '  "yearsOfExperience": number | null',
    "}",
    "",
    "要求：",
    "- coreSkills：不超过 12 个，尽量使用简洁技术/能力关键词",
    "- projectExperienceSummary：2-4 句中文摘要",
    "- keyAchievements：不超过 5 条，每条尽量量化（如果没有数据可用则写成定性）",
    "- yearsOfExperience：没有明确证据则返回 null",
  ].join("\n");

  const user = [
    "这是从 PDF 提取的简历文本（可能包含换行/分页噪声）：",
    params.resumeText,
    "",
    "请严格按 Schema 输出 JSON：",
  ].join("\n");

  const text = await chatCompletion({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    model: OPENROUTER_RESUME_MODEL,
    temperature: 0.1,
    maxTokens: 900,
    responseJson: true,
  });

  const parsed = tryParseJson(text) as Partial<{
    coreSkills: unknown;
    projectExperienceSummary: unknown;
    keyAchievements: unknown;
    yearsOfExperience: unknown;
  }>;

  return {
    coreSkills: Array.isArray(parsed.coreSkills) ? parsed.coreSkills.filter((s) => typeof s === "string") : [],
    projectExperienceSummary:
      typeof parsed.projectExperienceSummary === "string" ? parsed.projectExperienceSummary : "",
    keyAchievements: Array.isArray(parsed.keyAchievements)
      ? parsed.keyAchievements.filter((s) => typeof s === "string")
      : [],
    yearsOfExperience: typeof parsed.yearsOfExperience === "number" ? parsed.yearsOfExperience : null,
  };
}

export async function parseResumeMultimodal(params: {
  fileBase64: string;
  mimeType: string;
}) {
  const system = [
    "你是简历解析器。请从用户提供的 PDF 或图片简历中提取结构化信息，并只输出 JSON，不要输出任何解释、Markdown 或代码块。",
    "",
    "JSON Schema（严格遵守）：",
    "{",
    '  "coreSkills": string[],',
    '  "projectExperienceSummary": string,',
    '  "keyAchievements": string[],',
    '  "yearsOfExperience": number | null',
    "}",
    "",
    "要求：",
    "- coreSkills：不超过 12 个，尽量使用简洁技术/能力关键词",
    "- projectExperienceSummary：2-4 句中文摘要",
    "- keyAchievements：不超过 5 条，每条尽量量化（如果简历没有数据可用则写成定性）",
    "- yearsOfExperience：没有明确证据则返回 null",
  ].join("\n");

  const dataUrl = `data:${params.mimeType};base64,${params.fileBase64}`;
  const isPdf = params.mimeType === "application/pdf";

  const text = await chatCompletion({
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: "请解析以下简历文件：" },
          isPdf
            ? { type: "file", file: { filename: "resume.pdf", file_data: dataUrl, fileData: dataUrl } }
            : { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    model: OPENROUTER_RESUME_MODEL,
    temperature: 0.1,
    maxTokens: 900,
    responseJson: true,
    plugins: isPdf ? [{ id: "file-parser", pdf: { engine: "cloudflare-ai" } }] : undefined,
  });

  const parsed = tryParseJson(text) as Partial<{
    coreSkills: unknown;
    projectExperienceSummary: unknown;
    keyAchievements: unknown;
    yearsOfExperience: unknown;
  }>;

  return {
    coreSkills: Array.isArray(parsed.coreSkills) ? parsed.coreSkills.filter((s) => typeof s === "string") : [],
    projectExperienceSummary:
      typeof parsed.projectExperienceSummary === "string" ? parsed.projectExperienceSummary : "",
    keyAchievements: Array.isArray(parsed.keyAchievements)
      ? parsed.keyAchievements.filter((s) => typeof s === "string")
      : [],
    yearsOfExperience: typeof parsed.yearsOfExperience === "number" ? parsed.yearsOfExperience : null,
  };
}

export async function analyzeHrPersona(params: { jdText: string }) {
  const system = [
    "你是一名资深招聘顾问，擅长从岗位 JD 反推招聘者风格。",
    "请根据用户提供的 JD 文本，对招聘者风格做侧写分类，只输出 JSON，不要输出任何解释、Markdown 或代码块。",
    "",
    "The Persona Schema（只能三选一）：",
    "A. 技术硬核型（Technical Expert）：JD 罗列大量具体工具/版本号/架构名词/性能指标，偏理性，讨厌社交辞令，喜欢直聊底层与硬指标。",
    "B. 任务与效率型（Task-Oriented）：JD 强调快速落地/业务增长/0-1/抗压，职责清晰条理，偏结果导向，关注 SOP、基线、成功案例。",
    "C. 文化与管理型（Culture/People-Oriented）：JD 措辞温和，强调软技能/协作/价值观，公司背景描述多，关注共情与稳定性。",
    "",
    "JSON Schema（严格遵守）：",
    "{",
    '  "persona": "A" | "B" | "C",',
    '  "reason": string,',
    '  "suggestion": string',
    "}",
    "",
    "要求：",
    "- reason：2-3 句中文，必须引用 JD 的表述特征（不要编造 JD 未出现的内容）",
    "- suggestion：1 句中文，给候选人沟通策略建议（如“建议直切底层原理/性能指标”）",
  ].join("\n");

  const text = await chatCompletion({
    messages: [
      { role: "system", content: system },
      { role: "user", content: params.jdText },
    ],
    model: OPENROUTER_GREETING_MODEL,
    temperature: 0.2,
    maxTokens: 400,
    responseJson: true,
  });

  const parsed = tryParseJson(text) as Partial<{ persona: unknown; reason: unknown; suggestion: unknown }>;
  const persona: HrPersona = parsed.persona === "A" || parsed.persona === "B" || parsed.persona === "C"
    ? parsed.persona
    : "B";

  return {
    persona,
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
    suggestion: typeof parsed.suggestion === "string" ? parsed.suggestion : "",
  };
}

export async function streamGreetingText(params: {
  system: string;
  user: string;
  model?: string;
}) {
  const resp = await openrouterFetch("/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: params.model ?? OPENROUTER_GREETING_MODEL,
      stream: true,
      temperature: 0.6,
      max_tokens: 400,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.user },
      ],
    }),
  });

  if (resp.status === 429) {
    throw Object.assign(new Error("免费通道繁忙，请 5 秒后重试"), { status: 429 });
  }

  if (!resp.ok || !resp.body) {
    const t = await resp.text().catch(() => "");
    throw new Error(`OpenRouter 流式请求失败：${resp.status} ${resp.statusText}${t ? ` - ${t}` : ""}`);
  }

  const upstream = resp.body;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let buffer = "";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const lines = part.split("\n");
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith("data:")) continue;
              const payload = trimmed.slice("data:".length).trim();
              if (!payload) continue;
              if (payload === "[DONE]") {
                controller.close();
                return;
              }

              try {
                const json = JSON.parse(payload) as {
                  choices?: Array<{ delta?: { content?: string } }>;
                };
                const delta = json?.choices?.[0]?.delta?.content ?? "";
                if (delta) controller.enqueue(encoder.encode(delta));
              } catch {}
            }
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return stream;
}
