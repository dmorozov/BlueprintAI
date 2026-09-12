# Project Setup

## DeepSeek Code harness

Install from global:

```bash
npx @deepseek-ai/dsh web
```

or install from sources:

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

Add support for MCP:

```bash
pnpm dsh plugin --profile web add github:hyqhyq3/dsh-mcp-manager
```
