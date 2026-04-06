export const runtime = "nodejs";

import { analyzeHrPersona, type HrPersona } from "@/lib/ai-client";

function personaLabel(p: HrPersona) {
  if (p === "A") return "技术硬核型";
  if (p === "B") return "任务与效率型";
  return "文化与管理型";
}

function pickSome(input: string[], n: number) {
  const out: string[] = [];
  for (const it of input) {
    if (!out.includes(it)) out.push(it);
    if (out.length >= n) break;
  }
  return out;
}

function heuristicAnalyze(jdText: string): { persona: HrPersona; reason: string; suggestion: string } {
  const text = jdText.toLowerCase();

  const techKeywords = [
    "kafka",
    "redis",
    "mysql",
    "postgres",
    "postgresql",
    "mongodb",
    "elasticsearch",
    "clickhouse",
    "hbase",
    "hadoop",
    "spark",
    "flink",
    "kubernetes",
    "k8s",
    "docker",
    "grpc",
    "istio",
    "spring",
    "java",
    "golang",
    "go",
    "rust",
    "c++",
    "node",
    "node.js",
    "react",
    "vue",
    "nginx",
    "prometheus",
    "grafana",
  ];
  const metricKeywords = ["qps", "tps", "p99", "p95", "sla", "ms", "吞吐", "延迟", "可用性", "稳定性", "性能"];
  const taskKeywords = [
    "快速",
    "落地",
    "业务增长",
    "增长",
    "0-1",
    "从0到1",
    "抗压",
    "推进",
    "交付",
    "闭环",
    "sop",
    "基线",
    "里程碑",
    "迭代",
    "上线",
    "owner",
    "结果导向",
  ];
  const cultureKeywords = [
    "跨部门",
    "协作",
    "沟通",
    "团队",
    "氛围",
    "价值观",
    "认同",
    "共情",
    "文化",
    "管理",
    "带人",
    "mentor",
    "成长",
    "产品",
    "用户",
  ];

  const hitsTech = techKeywords.filter((k) => text.includes(k));
  const hitsMetric = metricKeywords.filter((k) => text.includes(k));
  const hitsTask = taskKeywords.filter((k) => text.includes(k));
  const hitsCulture = cultureKeywords.filter((k) => text.includes(k));

  const versionLikeCount = (jdText.match(/\b\d+(\.\d+)+\b/g) ?? []).length;

  const scoreA = hitsTech.length * 2 + hitsMetric.length * 3 + Math.min(versionLikeCount, 3) * 2;
  const scoreB = hitsTask.length * 3 + (jdText.includes("职责") ? 1 : 0) + (jdText.includes("要求") ? 1 : 0);
  const scoreC = hitsCulture.length * 3 + (jdText.includes("价值观") ? 2 : 0) + (jdText.includes("氛围") ? 2 : 0);

  let persona: HrPersona = "B";
  if (scoreA >= scoreB && scoreA >= scoreC) persona = "A";
  else if (scoreC > scoreA && scoreC >= scoreB) persona = "C";

  const techSignals = pickSome([...hitsTech, ...hitsMetric], 3);
  const taskSignals = pickSome(hitsTask, 3);
  const cultureSignals = pickSome(hitsCulture, 3);

  const suggestion = persona === "A"
    ? "建议直切底层原理/架构取舍与性能瓶颈，用可验证的事实点快速对齐。"
    : persona === "B"
      ? "建议用可落地的交付路径+避坑 SOP 展开，强调快速解决问题与结果闭环。"
      : "建议先表达对业务/产品的理解与协作方式，再补充匹配经历与共识点。";

  if (persona === "A") {
    const parts = [
      techSignals.length ? `JD 技术栈/指标密度较高（如：${techSignals.join("、")}）` : "JD 技术栈/指标密度较高",
      versionLikeCount ? `且出现版本/数值格式（共 ${versionLikeCount} 处）` : "",
      "更像技术硬核型招聘者。",
    ]
      .filter(Boolean)
      .join("，");
    return { persona, reason: parts, suggestion };
  }

  if (persona === "C") {
    const parts = [
      cultureSignals.length ? `JD 强调协作与文化匹配（如：${cultureSignals.join("、")}）` : "JD 强调协作与文化匹配",
      "更像文化与管理型招聘者。",
    ].join("，");
    return { persona, reason: parts, suggestion };
  }

  const parts = [
    taskSignals.length ? `JD 更偏结果与执行（如：${taskSignals.join("、")}）` : "JD 更偏结果与执行",
    "更像任务与效率型招聘者。",
  ].join("，");
  return { persona, reason: parts, suggestion };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { jdText?: string };
    const jdText = typeof body.jdText === "string" ? body.jdText : "";
    if (!jdText.trim()) return Response.json({ ok: false, error: "缺少 jdText" }, { status: 400 });

    let data: { persona: HrPersona; reason: string; suggestion: string };
    try {
      data = await analyzeHrPersona({ jdText: jdText.trim() });
    } catch {
      data = heuristicAnalyze(jdText.trim());
    }
    return Response.json({
      ok: true,
      data: {
        ...data,
        label: personaLabel(data.persona),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
