"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Tone = "professional" | "geek" | "warm";
type Phase = "idle" | "parsing" | "generating";
type OutputMode = "card" | "preview";
type HrPersona = "A" | "B" | "C";

type ResumeJson = {
  coreSkills: string[];
  projectExperienceSummary: string;
  keyAchievements: string[];
  yearsOfExperience: number | null;
};

type HrPersonaAnalysis = {
  persona: HrPersona;
  label: string;
  reason: string;
  suggestion: string;
};

function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-block size-4 rounded-full border-2 border-zinc-200 border-t-zinc-700 animate-spin dark:border-zinc-800 dark:border-t-zinc-100",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    />
  );
}

function TonePill({
  active,
  label,
  onClick,
  accentClassName,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  accentClassName: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "h-9 px-3 rounded-full border text-sm font-medium transition-colors",
        "bg-white text-zinc-900 border-zinc-200 hover:bg-zinc-50",
        "dark:bg-zinc-950 dark:text-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900/60",
        active ? ["shadow-sm", accentClassName].join(" ") : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </button>
  );
}

function PrimaryButton({
  tone,
  disabled,
  onClick,
  children,
}: {
  tone: Tone;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const cls = tone === "professional"
    ? "bg-indigo-600 hover:bg-indigo-500"
    : tone === "geek"
      ? "bg-emerald-600 hover:bg-emerald-500"
      : "bg-orange-600 hover:bg-orange-500";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "h-11 px-4 rounded-xl text-sm font-semibold text-white transition-colors",
        cls,
        "disabled:opacity-50 disabled:cursor-not-allowed",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function resumeCacheKey(sha256Hex: string) {
  return `resumeJson:v1:${sha256Hex}`;
}

async function sha256Hex(file: File) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function extractPdfText(file: File) {
  type PdfTextItem = { str?: unknown };
  type PdfPage = { getTextContent: () => Promise<{ items: PdfTextItem[] }> };
  type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage> };

  const buf = await file.arrayBuffer();
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdfjsAny = pdfjs as unknown as {
    version?: string;
    GlobalWorkerOptions?: { workerSrc?: string };
    getDocument: (p: unknown) => { promise: Promise<PdfDoc> };
  };

  const data = new Uint8Array(buf);

  const load = async (opts: unknown) => {
    const loadingTask = pdfjsAny.getDocument(opts);
    return loadingTask.promise;
  };

  if (pdfjsAny.GlobalWorkerOptions && !pdfjsAny.GlobalWorkerOptions.workerSrc) {
    pdfjsAny.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      import.meta.url,
    ).toString();
  }

  let pdf: PdfDoc;
  try {
    pdf = await load({ data, disableWorker: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('GlobalWorkerOptions.workerSrc')) {
      pdf = await load({ data });
    } else {
      throw e;
    }
  }

  const parts: string[] = [];
  const maxPages = Math.min(pdf.numPages, 20);

  for (let i = 1; i <= maxPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items
      .map((it) => (typeof it.str === "string" ? it.str : ""))
      .filter(Boolean);
    if (strings.length) parts.push(strings.join(" "));
  }

  const text = parts.join("\n").replace(/\s+\n/g, "\n").trim();
  return text;
}

export default function Home() {
  const [tone, setTone] = useState<Tone>("professional");
  const [phase, setPhase] = useState<Phase>("idle");
  const [outputMode, setOutputMode] = useState<OutputMode>("card");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeJson, setResumeJson] = useState<ResumeJson | null>(null);
  const [resumeText, setResumeText] = useState<string>("");
  const [resumeHash, setResumeHash] = useState<string | null>(null);
  const [resumeCacheHit, setResumeCacheHit] = useState(false);
  const [portfolioUrl, setPortfolioUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [hrAnalysis, setHrAnalysis] = useState<HrPersonaAnalysis | null>(null);
  const [hrAnalyzing, setHrAnalyzing] = useState(false);
  const [hrError, setHrError] = useState<string | null>(null);
  const [hrPersonaOverride, setHrPersonaOverride] = useState<"AUTO" | HrPersona>("AUTO");
  const [fullText, setFullText] = useState("");
  const [streamText, setStreamText] = useState("");
  const [editableText, setEditableText] = useState("");
  const [copied, setCopied] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(0);
  const streamingTimerRef = useRef<number | null>(null);
  const generatingLockRef = useRef(false);

  const accent = useMemo(() => {
    if (tone === "professional") return "text-indigo-600";
    if (tone === "geek") return "text-emerald-600";
    return "text-orange-600";
  }, [tone]);

  const effectiveText = useMemo(() => {
    if (phase === "generating") return streamText;
    return (editableText || fullText).trim();
  }, [editableText, fullText, phase, streamText]);

  const cooldownSeconds = useMemo(() => {
    const left = cooldownUntil - now;
    if (left <= 0) return 0;
    return Math.ceil(left / 1000);
  }, [cooldownUntil, now]);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  useEffect(() => {
    return () => {
      if (streamingTimerRef.current) window.clearInterval(streamingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!cooldownUntil) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [cooldownUntil]);

  useEffect(() => {
    if (!cooldownUntil) return;
    if (cooldownSeconds === 0) setCooldownUntil(0);
  }, [cooldownSeconds, cooldownUntil]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    const jd = jdText.trim();
    if (!jd) {
      setHrAnalysis(null);
      setHrError(null);
      setHrAnalyzing(false);
      return;
    }

    const t = window.setTimeout(async () => {
      setHrAnalyzing(true);
      setHrError(null);
      try {
        const resp = await fetch("/api/analyze-hr", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jdText: jd }),
        });
        if (resp.status === 429) {
          setHrError("免费通道繁忙，请 5 秒后重试");
          setHrAnalyzing(false);
          return;
        }
        const data = (await resp.json().catch(() => null)) as
          | { ok: true; data: HrPersonaAnalysis }
          | { ok: false; error: string }
          | null;
        if (!resp.ok || !data || data.ok === false) {
          setHrError((data && "error" in data ? data.error : null) || "HR 侧写失败");
          setHrAnalyzing(false);
          return;
        }
        setHrAnalysis(data.data);
        setHrAnalyzing(false);
      } catch (e) {
        setHrError(e instanceof Error ? e.message : "HR 侧写失败");
        setHrAnalyzing(false);
      }
    }, 600);

    return () => window.clearTimeout(t);
  }, [jdText]);

  function stopStreaming() {
    if (streamingTimerRef.current) window.clearInterval(streamingTimerRef.current);
    streamingTimerRef.current = null;
  }

  function onResumeFileSelected(file: File | null) {
    setResumeFile(file);
    setResumeJson(null);
    setResumeText("");
    setResumeHash(null);
    setResumeCacheHit(false);
    if (file) void parseResume(file);
  }

  async function parseResume(file: File) {
    setErrorText(null);
    setPhase("parsing");
    const hash = await sha256Hex(file).catch(() => null);
    const effectiveHash = hash ?? `${file.name}:${file.size}:${file.lastModified}`;
    setResumeHash(hash ?? null);

    const cachedRaw = (() => {
      try {
        return window.localStorage.getItem(resumeCacheKey(effectiveHash));
      } catch {
        return null;
      }
    })();

    if (cachedRaw) {
      try {
        const cached = JSON.parse(cachedRaw) as ResumeJson;
        setResumeJson(cached);
        setResumeCacheHit(true);
        setPhase("idle");
        return cached;
      } catch {
        try {
          window.localStorage.removeItem(resumeCacheKey(effectiveHash));
        } catch {}
      }
    }

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    let resp: Response;
    let extractedText = "";

    if (isPdf) {
      try {
        const t = await extractPdfText(file);
        if (t) {
          extractedText = t;
          setResumeText(t);
        }
        if (t && t.length >= 80) {
          resp = await fetch("/api/parse-resume", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ resumeText: t }),
          });
        } else {
          const form = new FormData();
          form.append("resume", file);
          resp = await fetch("/api/parse-resume", { method: "POST", body: form });
        }
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : "上传失败");
        setPhase("idle");
        return null;
      }
    } else {
      const form = new FormData();
      form.append("resume", file);
      try {
        resp = await fetch("/api/parse-resume", { method: "POST", body: form });
      } catch (e) {
        setErrorText(e instanceof Error ? e.message : "上传失败");
        setPhase("idle");
        return null;
      }
    }

    if (isPdf && !resp.ok && resp.status !== 429 && extractedText.trim()) {
      resp = await fetch("/api/parse-resume", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resumeText: extractedText.trim() }),
      });
    }

    if (resp.status === 429) {
      setErrorText("免费通道繁忙，请 5 秒后重试");
      setPhase("idle");
      return null;
    }
    const data = (await resp.json().catch(() => null)) as
      | { ok: true; data: ResumeJson }
      | { ok: false; error: string }
      | null;

    if (!resp.ok || !data || !("ok" in data) || data.ok === false) {
      const msg = data && "error" in data ? data.error : "简历解析失败";
      setErrorText(msg);
      setPhase("idle");
      return null;
    }

    setResumeJson(data.data);
    setResumeCacheHit(false);
    try {
      window.localStorage.setItem(resumeCacheKey(effectiveHash), JSON.stringify(data.data));
    } catch {}
    setPhase("idle");
    return data.data;
  }

  async function startGenerating() {
    if (phase !== "idle") return;
    if (cooldownUntil && Date.now() < cooldownUntil) return;
    if (generatingLockRef.current) return;
    generatingLockRef.current = true;
    stopStreaming();
    setErrorText(null);
    setCopied(false);
    try {
      let resolvedResumeJson = resumeJson;
      if (resumeFile && !resolvedResumeJson) {
        resolvedResumeJson = await parseResume(resumeFile);
        if (!resolvedResumeJson) return;
      }

      setPhase("generating");
      setStreamText("");
      setFullText("");
      setEditableText("");

      const resp = await fetch("/api/generate-greeting", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tone,
          resumeJson: resolvedResumeJson,
          resumeText,
          hrPersona: hrPersonaOverride !== "AUTO" ? hrPersonaOverride : hrAnalysis?.persona ?? "B",
          jdText,
          portfolioUrl,
        }),
      });
      if (resp.status === 429) {
        setCooldownUntil(Date.now() + 5000);
        setErrorText("免费通道繁忙，请稍后重试");
        setPhase("idle");
        return;
      }

      if (!resp.ok || !resp.body) {
        const data = (await resp.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        const msg = data?.error || "生成失败";
        setErrorText(msg);
        setPhase("idle");
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          acc += chunk;
          setStreamText(acc);
        }
      } finally {
        reader.releaseLock();
      }

      const finalText = acc.trim();
      setFullText(finalText);
      setEditableText(finalText);
      setPhase("idle");
    } finally {
      generatingLockRef.current = false;
    }
  }

  async function copyToClipboard() {
    if (!effectiveText) return;
    await navigator.clipboard.writeText(effectiveText);
    setCopied(true);
  }

  const canGenerate = Boolean(jdText.trim() || portfolioUrl.trim() || resumeFile);
  const canClickGenerate = canGenerate && phase === "idle" && cooldownSeconds === 0;

  return (
    <div className="min-h-dvh bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">
              招呼词生成器 <span className={["font-semibold", accent].join(" ")}>· UI 框架</span>
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Linear / Notion 风格：极简、专业、响应式布局（先做基础 UI 与交互骨架）。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <TonePill
              active={tone === "professional"}
              label="专业稳重"
              onClick={() => setTone("professional")}
              accentClassName="border-indigo-200 text-indigo-700 dark:border-indigo-900/50 dark:text-indigo-200"
            />
            <TonePill
              active={tone === "geek"}
              label="极客风"
              onClick={() => setTone("geek")}
              accentClassName="border-emerald-200 text-emerald-700 dark:border-emerald-900/50 dark:text-emerald-200"
            />
            <TonePill
              active={tone === "warm"}
              label="热情积极"
              onClick={() => setTone("warm")}
              accentClassName="border-orange-200 text-orange-700 dark:border-orange-900/50 dark:text-orange-200"
            />
          </div>
        </header>

        <main className="mt-5 grid grid-cols-1 items-start gap-5 sm:mt-6 sm:gap-6 lg:grid-cols-2 lg:gap-8">
          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/30">
            <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800 sm:px-5">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">输入区</h2>
                <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                  {phase === "parsing" ? (
                    <>
                      <Spinner />
                      解析中…
                    </>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="space-y-4 p-4 sm:space-y-5 sm:p-5">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100">简历上传</label>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">PDF / 图片</span>
                </div>

                <label className="group flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-3 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950/40 dark:hover:bg-zinc-950/70 sm:px-4 sm:py-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {resumeFile ? resumeFile.name : "点击选择文件（或后续可扩展拖拽上传）"}
                    </div>
                    <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                      {resumeFile ? `${Math.ceil(resumeFile.size / 1024)} KB` : "将通过服务端解析（API Key 不暴露前端）"}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition-colors group-hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:group-hover:bg-zinc-900">
                    选择文件
                  </span>
                  <input
                    type="file"
                    className="sr-only"
                    accept="application/pdf,.pdf,image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] ?? null;
                      onResumeFileSelected(file);
                    }}
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900">
                    仅选 PDF
                    <input
                      type="file"
                      className="sr-only"
                      accept="application/pdf,.pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        onResumeFileSelected(file);
                      }}
                    />
                  </label>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900">
                    仅选图片
                    <input
                      type="file"
                      className="sr-only"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] ?? null;
                        onResumeFileSelected(file);
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100">作品集链接</label>
                <input
                  value={portfolioUrl}
                  onChange={(e) => {
                    setPortfolioUrl(e.target.value);
                  }}
                  type="url"
                  inputMode="url"
                  placeholder="https://..."
                  className="h-11 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-900 dark:text-zinc-100">岗位 JD</label>
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  onBlur={() => {
                  }}
                  placeholder="粘贴岗位描述（建议包含职责/要求/关键技术栈等）…"
                  className="min-h-[180px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm leading-6 text-zinc-900 shadow-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600 sm:min-h-[240px]"
                />
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  {errorText
                    ? errorText
                    : cooldownSeconds > 0
                      ? `免费通道繁忙，请 ${cooldownSeconds} 秒后重试`
                    : hrAnalyzing
                      ? "HR 侧写分析中…"
                    : hrError
                      ? hrError
                    : resumeJson
                      ? `简历已解析${resumeCacheHit ? "（命中本地缓存）" : ""}${resumeHash ? ` · ${resumeHash.slice(0, 10)}…` : ""}`
                      : canGenerate
                        ? "已准备好生成（将调用服务端 API）。"
                        : "填写任意信息后即可生成。"}
                </div>
                <PrimaryButton tone={tone} disabled={!canClickGenerate} onClick={startGenerating}>
                  {phase === "generating" ? "生成中…" : "生成招呼词"}
                </PrimaryButton>
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900/30">
            <div className="border-b border-zinc-200 px-4 py-4 dark:border-zinc-800 sm:px-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">输出区</h2>
                  {phase === "generating" ? (
                    <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                      <Spinner />
                      生成中…
                    </div>
                  ) : null}
                </div>

                <button
                  type="button"
                  onClick={copyToClipboard}
                  disabled={!effectiveText}
                  className={[
                    "h-9 px-3 rounded-xl border text-sm font-semibold transition-colors",
                    "border-zinc-200 bg-white text-zinc-900 hover:bg-zinc-50",
                    "dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  ].join(" ")}
                >
                  {copied ? "已复制" : "一键复制"}
                </button>
              </div>

              <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">HR 侧写</span>
                  <span
                    className={[
                      "rounded-full border px-2 py-1 text-xs font-semibold",
                      "border-zinc-200 bg-zinc-50 text-zinc-800",
                      "dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200",
                    ].join(" ")}
                  >
                    {hrPersonaOverride !== "AUTO"
                      ? hrPersonaOverride === "A"
                        ? "技术硬核型（手动）"
                        : hrPersonaOverride === "B"
                          ? "任务与效率型（手动）"
                          : "文化与管理型（手动）"
                      : hrAnalysis
                        ? `${hrAnalysis.label}（AI）`
                        : jdText.trim()
                          ? "待分析"
                          : "—"}
                  </span>
                  {hrAnalysis?.suggestion ? (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">{hrAnalysis.suggestion}</span>
                  ) : null}
                </div>

                <select
                  value={hrPersonaOverride}
                  onChange={(e) => setHrPersonaOverride(e.target.value as "AUTO" | HrPersona)}
                  className="h-9 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm text-zinc-900 shadow-sm outline-none transition focus:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600 sm:w-auto"
                >
                  <option value="AUTO">自动（AI 判断）</option>
                  <option value="A">技术硬核型</option>
                  <option value="B">任务与效率型</option>
                  <option value="C">文化与管理型</option>
                </select>
              </div>
            </div>

            <div className="p-4 sm:p-5">
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/40">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-400">招呼词</div>
                  <div className="flex items-center gap-2">
                    <div className="rounded-xl border border-zinc-200 bg-white p-1 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                      <button
                        type="button"
                        onClick={() => setOutputMode("card")}
                        className={[
                          "h-8 px-3 rounded-lg text-xs font-semibold transition-colors",
                          outputMode === "card"
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                            : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900",
                        ].join(" ")}
                      >
                        正文
                      </button>
                      <button
                        type="button"
                        onClick={() => setOutputMode("preview")}
                        className={[
                          "h-8 px-3 rounded-lg text-xs font-semibold transition-colors",
                          outputMode === "preview"
                            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950"
                            : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-900",
                        ].join(" ")}
                      >
                        预览
                      </button>
                    </div>
                    <div className="text-xs text-zinc-500 dark:text-zinc-400">
                      {effectiveText ? `${Array.from(effectiveText).length} 字` : "0 字"}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  {outputMode === "card" ? (
                    <div className="min-h-[200px] whitespace-pre-wrap rounded-xl bg-white px-4 py-4 text-sm leading-7 text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100 sm:min-h-[240px]">
                      {errorText ? (
                        <div className="text-sm leading-7 text-rose-600 dark:text-rose-400">{errorText}</div>
                      ) : effectiveText ? (
                        <>
                          {effectiveText}
                          {phase === "generating" ? (
                            <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-zinc-300 align-middle dark:bg-zinc-700" />
                          ) : null}
                        </>
                      ) : (
                        <div className="space-y-2">
                          <div className="h-4 w-3/5 rounded bg-zinc-100 dark:bg-zinc-900" />
                          <div className="h-4 w-11/12 rounded bg-zinc-100 dark:bg-zinc-900" />
                          <div className="h-4 w-10/12 rounded bg-zinc-100 dark:bg-zinc-900" />
                          <div className="h-4 w-2/3 rounded bg-zinc-100 dark:bg-zinc-900" />
                          <div className="pt-2 text-xs text-zinc-500 dark:text-zinc-400">
                            点击“生成招呼词”查看生成结果与流式加载效果。
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="min-h-[200px] rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950 sm:min-h-[240px]">
                      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
                        <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">对话预览</div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400">Boss 直聘 / 微信风格</div>
                      </div>
                      <div className="space-y-3 bg-zinc-50 px-4 py-4 dark:bg-zinc-900/20">
                        <div className="flex items-start gap-2">
                          <div className="mt-0.5 size-8 rounded-full border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950" />
                          <div className="max-w-[85%] rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 text-zinc-800 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                            你好，方便简单介绍一下你的核心优势吗？
                          </div>
                        </div>
                        <div className="flex items-start justify-end gap-2">
                          <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 text-white shadow-sm" style={{
                            background:
                              tone === "professional"
                                ? "linear-gradient(135deg, rgb(79,70,229), rgb(59,130,246))"
                                : tone === "geek"
                                  ? "linear-gradient(135deg, rgb(16,185,129), rgb(34,197,94))"
                                  : "linear-gradient(135deg, rgb(249,115,22), rgb(245,158,11))",
                          }}>
                            {errorText ? (
                              <span className="text-white/90">{errorText}</span>
                            ) : effectiveText ? (
                              <>
                                {effectiveText}
                                {phase === "generating" ? (
                                  <span className="ml-0.5 inline-block h-4 w-2 animate-pulse rounded-sm bg-white/60 align-middle" />
                                ) : null}
                              </>
                            ) : (
                              <span className="text-white/80">生成后在这里预览气泡效果。</span>
                            )}
                          </div>
                          <div className="mt-0.5 size-8 rounded-full border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">局部修改</div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {phase === "generating" ? "生成中暂不可编辑" : "编辑后会同步到正文/预览与复制内容"}
                  </div>
                </div>
                <textarea
                  value={phase === "generating" ? streamText : editableText}
                  onChange={(e) => {
                    if (phase === "generating") return;
                    setEditableText(e.target.value);
                    setCopied(false);
                  }}
                  placeholder="在这里手动微调句子、替换关键词、补充亮点…"
                  disabled={phase === "generating"}
                  className="mt-3 min-h-[110px] w-full resize-none rounded-xl border border-zinc-200 bg-white px-3 py-3 text-sm leading-6 text-zinc-900 shadow-sm outline-none transition focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100 dark:focus:border-zinc-600 sm:min-h-[120px]"
                />
              </div>

              <div className="mt-4 rounded-2xl border border-zinc-200 bg-white p-4 text-xs text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-zinc-900 dark:text-zinc-100">状态</div>
                  <div className="text-zinc-500 dark:text-zinc-400">
                    {phase === "idle" ? "待命" : phase === "parsing" ? "解析中" : "生成中"}
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <span>解析中</span>
                    {phase === "parsing" ? <Spinner className="size-3" /> : <span className="text-zinc-400">—</span>}
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/30">
                    <span>生成中</span>
                    {phase === "generating" ? <Spinner className="size-3" /> : <span className="text-zinc-400">—</span>}
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
