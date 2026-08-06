-- =============================================================================
-- 手搓 Claude Code — PostgreSQL 初始化脚本（pgvector 向量检索 + 业务数据）
--
-- 用法：
--   psql -U postgres -f db/init.sql
-- 或
--   psql -U postgres -c "CREATE DATABASE ai_agent;"
--   psql -U postgres -d ai_agent -f db/init.sql
--
-- 完成后配置 .env：
--   VECTOR_STORE=pg
--   PG_CONNECTION_STRING=postgres://postgres:yourpassword@localhost:5432/ai_agent
--
-- 说明：以下表覆盖成长计划 PostgreSQL 要求：
--   表设计 / 索引 / 事务 / 锁 / JSONB / 全文检索 / pgvector
-- =============================================================================

-- 1. 向量检索扩展（pgvector）
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 文档向量表（RAG search_docs 的 pgvector 后端）
CREATE TABLE IF NOT EXISTS doc_vectors (
  id        TEXT PRIMARY KEY,          -- "<相对路径>#<起始行>"
  embedding vector(384),               -- 向量列（与 embedding 维度一致）
  metadata  JSONB NOT NULL DEFAULT '{}',  -- {file, heading, startLine, text}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- HNSW 余弦索引（近似最近邻检索，比暴力扫描快）
CREATE INDEX IF NOT EXISTS doc_vectors_hnsw_idx
  ON doc_vectors USING hnsw (embedding vector_cosine_ops);

-- 元数据上的 GIN 索引（JSONB 过滤加速）
CREATE INDEX IF NOT EXISTS doc_vectors_meta_idx ON doc_vectors USING gin (metadata);

-- 3. 业务数据：会话表
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  cwd        TEXT NOT NULL,
  model      TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  meta       JSONB NOT NULL DEFAULT '{}'   -- 扩展字段（来源、标记等）
);

-- 4. 消息表（会话消息历史，JSONB 存内容块）
CREATE TABLE IF NOT EXISTS messages (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    JSONB NOT NULL,             -- 文本块 / tool_use / tool_result 结构
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_session_idx ON messages (session_id, id);

-- 5. 任务状态表（多 agent 协作的任务看板，锁字段防并发认领）
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  subject    TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'in_progress', 'completed')),
  owner      TEXT,
  blocked_by JSONB NOT NULL DEFAULT '[]',   -- 依赖任务 id 数组
  worktree   TEXT,
  lock_owner TEXT,                          -- 乐观锁：并发 claim 防 TOCTOU
  lock_ts    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (owner);

-- 6. 全文检索示例（docs 目录内容检索，tsvector）
ALTER TABLE doc_vectors ADD COLUMN IF NOT EXISTS search_text tsvector;
CREATE INDEX IF NOT EXISTS doc_vectors_search_idx ON doc_vectors USING gin (search_text);

-- 触发更新全文索引
CREATE OR REPLACE FUNCTION doc_vectors_search_update() RETURNS trigger AS $$
BEGIN
  NEW.search_text := to_tsvector('simple', coalesce(NEW.metadata->>'text', ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS doc_vectors_search_trigger ON doc_vectors;
CREATE TRIGGER doc_vectors_search_trigger
  BEFORE INSERT OR UPDATE ON doc_vectors
  FOR EACH ROW EXECUTE FUNCTION doc_vectors_search_update();

-- 示例查询：
--   向量检索（余弦距离，越大越相似）：
--     SELECT id, 1 - (embedding <=> '<vec>'::vector) AS score, metadata
--     FROM doc_vectors ORDER BY embedding <=> '<vec>'::vector LIMIT 5;
--   全文检索：
--     SELECT id, metadata FROM doc_vectors WHERE search_text @@ to_tsquery('simple', 'api_key');
--   任务认领（乐观锁事务）：
--     BEGIN;
--     UPDATE tasks SET owner='alice', lock_owner='alice', lock_ts=now()
--     WHERE id=$1 AND status='pending' AND lock_owner IS NULL;
--     COMMIT;
