export const runtime = "nodejs";

import { parseResumeFromText, parseResumeMultimodal } from "@/lib/ai-client";

function toBase64(arrayBuffer: ArrayBuffer) {
  return Buffer.from(arrayBuffer).toString("base64");
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = (await req.json()) as { resumeText?: string };
      const resumeText = typeof body.resumeText === "string" ? body.resumeText : "";
      if (!resumeText.trim()) return Response.json({ error: "缺少 resumeText" }, { status: 400 });

      const json = await parseResumeFromText({ resumeText });
      return Response.json({ ok: true, data: json });
    }

    const formData = await req.formData();
    const file = formData.get("resume");
    if (!(file instanceof Blob)) return Response.json({ error: "缺少 resume 文件字段" }, { status: 400 });

    const mimeType = file.type || "application/octet-stream";
    const bytes = await file.arrayBuffer();
    const fileBase64 = toBase64(bytes);
    const json = await parseResumeMultimodal({ fileBase64, mimeType });

    return Response.json({ ok: true, data: json });
  } catch (e) {
    const message = e instanceof Error ? e.message : "未知错误";
    const status = e && typeof e === "object" && "status" in e && typeof e.status === "number" ? e.status : 500;
    return Response.json({ ok: false, error: message }, { status });
  }
}
