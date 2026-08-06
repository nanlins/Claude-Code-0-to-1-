# RAG 向量检索与 PostgreSQL 部署

> 本文档对应成长计划对 PostgreSQL 的要求：表设计、索引、事务、锁、JSONB、全文检索、pgvector。

## 一、架构（可插拔三层）

```
┌─ 嵌入层 ─────────────────────────────────────────────┐
│  OpenAiCompatibleEmbedder（API，语义质量高）           │
│  LocalHashEmbedder（零依赖兜底，离线演示）             │
├─ 存储层 ─────────────────────────────────────────────┤
│  InMemoryVectorStore（默认，JSON 持久化，零依赖）      │
│  PgVectorStore（pgvector：HNSW 索引 + JSONB 元数据）  │
├─ 索引层 ─────────────────────────────────────────────┤
│  DocIndexer：分块 → embedding → 入库（按 mtime 增量） │
└─ 检索层 ─────────────────────────────────────────────┘
  search_docs：向量 Top-K × 0.6 + 关键词 × 0.4 混合排序
  index_docs：增量建索引（/index_docs）
```

## 二、两种运行模式

### 模式 A：零依赖（默认，离线可跑）

不配置任何环境变量即可工作：

- embedding 用 `LocalHashEmbedder`（字符 n-gram 哈希 + 归一化）
- 存储用 `InMemoryVectorStore`（`.vector_index/vectors.json` 持久化）

```powershell
npm start
# 对 agent 说: 先运行 index_docs 建立索引, 然后 search_docs 搜索"ANTHROPIC_API_KEY 怎么配置"
```

### 模式 B1：Docker + pgvector（推荐，一条命令）

pgvector 官方提供带扩展的 Docker 镜像，免编译：

```powershell
docker run -d --name pgvector-db `
  -e POSTGRES_PASSWORD=你的密码 `
  -p 5434:5432 `
  -v pgvector_data:/var/lib/postgresql/data `
  pgvector/pgvector:pg17

# 建库 + 初始化表
docker exec pgvector-db psql -U postgres -c "CREATE DATABASE ai_agent;"
docker cp db/init.sql pgvector-db:/init.sql
docker exec pgvector-db psql -U postgres -d ai_agent -f /init.sql
```

配置 `.env`：

```env
VECTOR_STORE=pg
PG_CONNECTION_STRING=postgres://postgres:你的密码@localhost:5434/ai_agent
```

### 模式 B2：本地 PostgreSQL + 手动安装 pgvector

1. **安装 PostgreSQL**：https://www.postgresql.org/download/windows/（安装时记录密码）
2. **安装 pgvector 扩展**（Windows 无官方预编译，二选一）：
   - EDB Stack Builder（`<PG安装目录>\bin\stackbuilder.exe`，勾选 pgvector）
   - 或 Docker 方案（见 B1）
3. **执行初始化脚本**：

```powershell
psql -U postgres -c "CREATE DATABASE ai_agent;"
psql -U postgres -d ai_agent -f db/init.sql
```

4. **配置 .env**：

```env
VECTOR_STORE=pg
PG_CONNECTION_STRING=postgres://postgres:你的密码@localhost:5432/ai_agent
```

（可选：配 `EMBEDDING_BASE_URL`/`EMBEDDING_API_KEY`/`EMBEDDING_MODEL` 换真实 embedding 模型，如硅基流动 `BAAI/bge-m3`）

## 三、表设计说明（db/init.sql）

| 表 | 用途 | 关键技术 |
|----|------|---------|
| `doc_vectors` | RAG 向量 | `vector(384)` 列 + HNSW 索引 + JSONB 元数据 + GIN 索引 + tsvector 全文检索触发器 |
| `sessions` | 会话 | JSONB 扩展字段 |
| `messages` | 消息历史 | JSONB 存内容块，外键级联删除 |
| `tasks` | 任务看板 | `lock_owner`/`lock_ts` 乐观锁防并发认领，blocked_by JSONB 依赖图 |

## 四、工程知识点对应

- **事务**：`PgVectorStore.upsertMany` 批量写入用 BEGIN/COMMIT/ROLLBACK
- **锁**：任务认领用乐观锁（`UPDATE ... WHERE status='pending' AND lock_owner IS NULL`），对应代码层 proper-lockfile
- **JSONB**：块元数据（file/heading/startLine/text）与任务依赖图
- **全文检索**：`doc_vectors` 上 tsvector 触发器 + GIN 索引，`@@ to_tsquery` 查询
- **pgvector**：`<=>` 余弦距离、`vector_cosine_ops` HNSW 索引

## 五、验证

```powershell
# 单元测试（含 RAG：索引/混合检索/增量/分块）
npm test

# 端到端（真实 LLM，需 .env）
npm start
#   1. "index_docs"
#   2. "用 search_docs 查 ANTHROPIC_API_KEY 的配置方法，并给出文件路径"
```
