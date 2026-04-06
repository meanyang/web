export const runtime = "nodejs";

import { streamGreetingText } from "@/lib/ai-client";

type Tone = "professional" | "geek" | "warm";
type HrPersona = "A" | "B" | "C";

type ResumeJson = {
  coreSkills: string[];
  projectExperienceSummary: string;
  keyAchievements: string[];
  yearsOfExperience: number | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      tone?: Tone;
      resumeJson?: ResumeJson | null;
      resumeText?: string;
      hrPersona?: HrPersona;
      jdText?: string;
      portfolioUrl?: string;
    };

    const tone: Tone = body.tone ?? "professional";
    const jdText = typeof body.jdText === "string" ? body.jdText : "";
    const resumeJson = body.resumeJson ?? null;
    const resumeText = typeof body.resumeText === "string" ? body.resumeText : "";
    const hrPersona: HrPersona = body.hrPersona === "A" || body.hrPersona === "B" || body.hrPersona === "C"
      ? body.hrPersona
      : "B";
    const portfolioUrl = typeof body.portfolioUrl === "string" ? body.portfolioUrl : undefined;

    const system = [
      "角色设定：你是一名拥有 15 年经验的资深猎头，擅长用最精炼的语言帮中高端人才敲开名企大门。",
      "任务目标：根据简历和 JD，生成一段高转化率的打招呼语。",
      "",
      "核心指令：严禁编造数据。",
      "数据来源：所有技术指标（如 QPS、TPS、延迟、用户量、服务器数量等）必须 100% 提取自用户简历原文；找不到就不要写具体数字。",
      "模糊化处理：如果简历中没有具体量化指标，请使用“大幅提升性能”、“优化了系统吞吐”等描述性表述，严禁自行填充具体数字。",
      "引用规范：如果简历中提到了 A 项目，只能关联 A 项目的实际成果，不要把 B 项目的数据套在 A 上。",
      "",
      "HR 侧写（The Persona Schema）：",
      "A 技术硬核型：偏理性，直切底层原理/架构/性能要求，讨厌社交辞令。",
      "B 任务与效率型：偏结果导向，强调快速落地/增长/0-1，喜欢 SOP、基线与避坑经验。",
      "C 文化与管理型：偏协作与价值观，强调软技能/跨部门/团队氛围与产品认同。",
      "",
      "生成策略（按侧写调整篇幅）：",
      "- A：约 50% 篇幅聚焦架构/性能/底层原理/难点拆解（若简历无量化指标则只能用模糊表述）。",
      "- B：约 50% 篇幅聚焦交付/落地路径/避坑 SOP/结果闭环。",
      "- C：约 30% 篇幅聚焦业务理解/沟通协作/团队匹配与真实认同。",
      "强制要求：",
      "1) 杜绝废话：不要说“非常荣幸看到您的招聘”。",
      "2) 黄金前 20 字：第一句话必须是“硬核标签 + 核心匹配点”（如：13 年 Node.js 开发，曾主导过类似贵司的 BLE 架构设计）。",
      "3) 钩子原则：必须从作品集中提取一个具体亮点，或从简历中找出一个与 JD 痛点精准重合的项目。",
      "4) 人味儿：语气要专业、对等、自信，不要像说明书，也不要像求职信。",
      "5) 长度限制：120-150 字，适合手机端一屏阅读。",
      "",
      "输出格式：只输出最终招呼词正文；不要输出 HR 侧写结论；不要 Markdown；不要列表；不要引号包裹；不要暴露任何推理过程。",
    ].join("\n");

    const user = [
      `HR 侧写已确定为：${hrPersona}（请不要重新判断，直接按该侧写生成）。`,
      `风格：${tone === "professional" ? "专业稳重" : tone === "geek" ? "极客风" : "热情积极"}`,
      portfolioUrl?.trim() ? `作品集链接：${portfolioUrl.trim()}` : "",
      "岗位 JD：",
      jdText.trim() || "（用户未提供 JD）",
      "",
      resumeText.trim() ? "简历原文（仅以此为准）：\n" + resumeText.trim() : "简历原文：未提供（因此不要输出任何具体数字指标）",
      "",
      "简历 JSON：",
      resumeJson ? JSON.stringify(resumeJson) : "null",
      "",
      "请输出最终招呼词：",
    ]
      .filter(Boolean)
      .join("\n");

    const stream = await streamGreetingText({ system, user });
    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-cache, no-transform",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    const status = e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 500;
    return Response.json(
      { ok: false, error: message },
      {
        status,
        ...(status === 429 ? { headers: { "retry-after": "5" } } : {}),
      },
    );
  }
}
