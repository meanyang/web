# 环境变量配置清单

本项目在服务端（API Routes）调用第三方模型接口，需要在运行环境中配置以下环境变量。请把它们放到 `web/.env.local`（本地开发）或部署平台的环境变量配置中。

## 必填

### OpenRouter（统一入口：简历解析 + 招呼词生成）

- `OPENROUTER_API_KEY`
  - 用途：通过 OpenRouter 调用 `qwen/qwen-3.6-plus:free`
  - 使用位置：服务端（`/api/parse-resume`、`/api/generate-greeting`）

## 内置配置（代码里已固定）

以下项在代码里已固定，不需要配置到环境变量：

- Base URL：`https://openrouter.ai/api/v1`
- 必须 Headers：
  - `HTTP-Referer`: `http://localhost:3000`
  - `X-OpenRouter-Title`: `Recruit-Copilot`
- 模型：`qwen/qwen-3.6-plus:free`

## 本地示例（不要提交真实 Key）

在 `web/.env.local` 中添加：

```ini
OPENROUTER_API_KEY=your_openrouter_key
```
