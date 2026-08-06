# 手搓 Claude Code (Anvil) - 多阶段构建
# 目标：镜像最小化 + 构建缓存加速

# ---------- 阶段1: 依赖 + 编译 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制依赖清单（利用层缓存，package.json 没变时跳过 npm install）
COPY package*.json ./
RUN npm ci --ignore-scripts && npm cache clean --force

# 复制源码并编译
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ---------- 阶段2: 生产依赖 ----------
FROM node:20-alpine AS deps

WORKDIR /app
COPY package*.json ./
# 只装生产依赖（不含 devDependencies）
# --omit=optional 跳过 @napi-rs/canvas 等可选依赖（pdf 文本提取不需要 canvas 渲染，省 ~30MB）
RUN npm ci --omit=dev --omit=optional --ignore-scripts && npm cache clean --force

# ---------- 阶段3: 精简运行镜像 ----------
FROM node:20-alpine

WORKDIR /app

# 安装 git（worktree 需要）+ curl（健康检查备用）
RUN apk add --no-cache git curl

# 环境变量
ENV NODE_ENV=production
ENV PORT=5173

# 复制编译产物 + 生产依赖
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 复制技能和示例
COPY skills/ ./skills/
COPY examples/ ./examples/

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://localhost:5173/api/config || exit 1

# 非 root 用户运行（安全）
RUN addgroup -S anvil && adduser -S anvil -G anvil \
  && chown -R anvil:anvil /app
USER anvil

# 暴露端口
EXPOSE 5173

# 启动（编译后的入口，兼容 .js）
CMD ["node", "dist/web-server.js"]
