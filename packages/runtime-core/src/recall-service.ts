import type {
  MemoryRecord,
  MemorySearchQuery,
  MemorySearchResponse,
  RecallDetail,
  RecallQuery,
  RecallResult,
  RecallSearchResponse,
  RecallSourceKind,
} from '@popeye/contracts';

import { sanitizeFtsQuery } from './run-event-search.js';

interface RecallDb {
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
}

interface AppRecallRow {
  source_id: string;
  title: string;
  content: string;
  created_at: string;
  workspace_id: string | null;
  project_id: string | null;
  run_id: string | null;
  task_id: string | null;
  session_root_id: string | null;
  subtype: string | null;
  status: string | null;
  raw_rank: number;
}

export interface RecallServiceDeps {
  appDb: RecallDb;
  searchMemory: (query: MemorySearchQuery) => Promise<MemorySearchResponse>;
  getMemory: (memoryId: string) => MemoryRecord | null;
}

function truncate(text: string, maxChars: number = 280): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function computeRecencyScore(createdAt: string): number {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return 0;
  const ageDays = Math.max(0, (Date.now() - createdMs) / (1000 * 60 * 60 * 24));
  return Math.exp(-ageDays / 30);
}

function computeArtifactScore(rawRank: number, createdAt: string, query: RecallQuery, row: Pick<AppRecallRow, 'workspace_id' | 'project_id'>): number {
  const rankScore = 1 / (1 + Math.abs(rawRank));
  const recencyScore = computeRecencyScore(createdAt);
  let scopeBonus = 0;
  if (query.projectId && row.project_id === query.projectId) {
    scopeBonus = 0.08;
  } else if (query.workspaceId && row.workspace_id === query.workspaceId) {
    scopeBonus = 0.04;
  }
  return Math.min(1, (rankScore * 0.85) + (recencyScore * 0.15) + scopeBonus);
}

function buildLocationConditions(
  query: RecallQuery,
  workspaceExpr: string,
  projectExpr: string,
): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (query.workspaceId) {
    sql.push(`${workspaceExpr} = ?`);
    params.push(query.workspaceId);
  }
  if (query.projectId) {
    sql.push(`${projectExpr} = ?`);
    params.push(query.projectId);
  }
  return { sql, params };
}

function mapAppRow(sourceKind: RecallSourceKind, query: RecallQuery, row: AppRecallRow): RecallResult {
  const snippet = truncate(row.content);
  return {
    sourceKind,
    sourceId: row.source_id,
    title: row.title,
    snippet,
    score: computeArtifactScore(row.raw_rank, row.created_at, query, row),
    createdAt: row.created_at,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    runId: row.run_id,
    taskId: row.task_id,
    sessionRootId: row.session_root_id,
    subtype: row.subtype,
    status: row.status,
  };
}

export class RecallService {
  private readonly db: RecallDb;
  private readonly searchMemoryFn: RecallServiceDeps['searchMemory'];
  private readonly getMemoryFn: RecallServiceDeps['getMemory'];

  constructor(deps: RecallServiceDeps) {
    this.db = deps.appDb;
    this.searchMemoryFn = deps.searchMemory;
    this.getMemoryFn = deps.getMemory;
  }

  private shouldSearch(query: RecallQuery, kind: RecallSourceKind): boolean {
    return query.kinds === undefined || query.kinds.includes(kind);
  }

  private searchReceipts(query: RecallQuery, matchExpr: string, limit: number): RecallResult[] {
    const params: unknown[] = [matchExpr];
    const conditions = ['receipts_fts MATCH ?'];
    const location = buildLocationConditions(query, 'r.workspace_id', 't.project_id');
    conditions.push(...location.sql);
    params.push(...location.params, limit);
    const rows = this.db.prepare(`
      SELECT
        f.receipt_id AS source_id,
        r.summary AS title,
        COALESCE(NULLIF(r.details, ''), r.summary) AS content,
        r.created_at,
        r.workspace_id,
        t.project_id,
        r.run_id,
        r.task_id,
        run.session_root_id,
        r.status AS subtype,
        r.status,
        bm25(receipts_fts) AS raw_rank
      FROM receipts_fts f
      JOIN receipts r ON r.id = f.receipt_id
      LEFT JOIN tasks t ON t.id = r.task_id
      LEFT JOIN runs run ON run.id = r.run_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY raw_rank
      LIMIT ?
    `).all(...params) as AppRecallRow[];
    return rows.map((row) => mapAppRow('receipt', query, row));
  }

  private searchRunEvents(query: RecallQuery, matchExpr: string, limit: number): RecallResult[] {
    const params: unknown[] = [matchExpr];
    const conditions = ['run_events_fts MATCH ?'];
    const location = buildLocationConditions(query, 'r.workspace_id', 't.project_id');
    conditions.push(...location.sql);
    params.push(...location.params, limit);
    const rows = this.db.prepare(`
      SELECT
        f.event_id AS source_id,
        ('Run event: ' || re.type) AS title,
        re.payload AS content,
        re.created_at,
        r.workspace_id,
        t.project_id,
        re.run_id,
        r.task_id,
        r.session_root_id,
        re.type AS subtype,
        r.state AS status,
        bm25(run_events_fts) AS raw_rank
      FROM run_events_fts f
      JOIN run_events re ON re.id = f.event_id
      JOIN runs r ON r.id = re.run_id
      LEFT JOIN tasks t ON t.id = r.task_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY raw_rank
      LIMIT ?
    `).all(...params) as AppRecallRow[];
    return rows.map((row) => mapAppRow('run_event', query, row));
  }

  private searchMessages(query: RecallQuery, matchExpr: string, limit: number): RecallResult[] {
    const params: unknown[] = [matchExpr];
    const conditions = ['messages_fts MATCH ?'];
    const location = buildLocationConditions(query, 'COALESCE(mi.workspace_id, r.workspace_id)', 't.project_id');
    conditions.push(...location.sql);
    params.push(...location.params, limit);
    const rows = this.db.prepare(`
      SELECT
        f.message_id AS source_id,
        ('Message from ' || m.sender_id) AS title,
        m.body AS content,
        m.created_at,
        COALESCE(mi.workspace_id, r.workspace_id) AS workspace_id,
        t.project_id,
        COALESCE(m.related_run_id, mi.run_id) AS run_id,
        COALESCE(mi.task_id, r.task_id) AS task_id,
        r.session_root_id,
        m.source AS subtype,
        CASE WHEN m.accepted = 1 THEN 'accepted' ELSE 'rejected' END AS status,
        bm25(messages_fts) AS raw_rank
      FROM messages_fts f
      JOIN messages m ON m.id = f.message_id
      LEFT JOIN message_ingress mi ON mi.message_id = m.id
      LEFT JOIN runs r ON r.id = COALESCE(m.related_run_id, mi.run_id)
      LEFT JOIN tasks t ON t.id = COALESCE(mi.task_id, r.task_id)
      WHERE ${conditions.join(' AND ')}
      ORDER BY raw_rank
      LIMIT ?
    `).all(...params) as AppRecallRow[];
    return rows.map((row) => mapAppRow('message', query, row));
  }

  private searchMessageIngress(query: RecallQuery, matchExpr: string, limit: number): RecallResult[] {
    const params: unknown[] = [matchExpr];
    const conditions = ['message_ingress_fts MATCH ?'];
    const location = buildLocationConditions(query, 'mi.workspace_id', 't.project_id');
    conditions.push(...location.sql);
    params.push(...location.params, limit);
    const rows = this.db.prepare(`
      SELECT
        f.ingress_id AS source_id,
        ('Ingress: ' || mi.decision_code) AS title,
        (mi.body || '\n\nDecision: ' || mi.decision_reason) AS content,
        mi.created_at,
        mi.workspace_id,
        t.project_id,
        mi.run_id,
        mi.task_id,
        r.session_root_id,
        mi.source AS subtype,
        CASE WHEN mi.accepted = 1 THEN 'accepted' ELSE mi.decision_code END AS status,
        bm25(message_ingress_fts) AS raw_rank
      FROM message_ingress_fts f
      JOIN message_ingress mi ON mi.id = f.ingress_id
      LEFT JOIN tasks t ON t.id = mi.task_id
      LEFT JOIN runs r ON r.id = mi.run_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY raw_rank
      LIMIT ?
    `).all(...params) as AppRecallRow[];
    return rows.map((row) => mapAppRow('message_ingress', query, row));
  }

  private searchInterventions(query: RecallQuery, matchExpr: string, limit: number): RecallResult[] {
    const params: unknown[] = [matchExpr];
    const conditions = ['interventions_fts MATCH ?'];
    const location = buildLocationConditions(query, 'r.workspace_id', 't.project_id');
    conditions.push(...location.sql);
    params.push(...location.params, limit);
    const rows = this.db.prepare(`
      SELECT
        f.intervention_id AS source_id,
        ('Intervention: ' || i.code) AS title,
        COALESCE(i.resolution_note || '\n\n', '') || i.reason AS content,
        i.created_at,
        r.workspace_id,
        t.project_id,
        i.run_id,
        r.task_id,
        r.session_root_id,
        i.code AS subtype,
        i.status,
        bm25(interventions_fts) AS raw_rank
      FROM interventions_fts f
      JOIN interventions i ON i.id = f.intervention_id
      LEFT JOIN runs r ON r.id = i.run_id
      LEFT JOIN tasks t ON t.id = r.task_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY raw_rank
      LIMIT ?
    `).all(...params) as AppRecallRow[];
    return rows.map((row) => mapAppRow('intervention', query, row));
  }

  private async searchMemory(query: RecallQuery, limit: number): Promise<RecallResult[]> {
    const response = await this.searchMemoryFn({
      query: query.query,
      ...(query.workspaceId !== undefined ? { workspaceId: query.workspaceId } : {}),
      ...(query.projectId !== undefined ? { projectId: query.projectId } : {}),
      ...(query.includeGlobal !== undefined ? { includeGlobal: query.includeGlobal } : {}),
      limit,
      includeContent: true,
    });

    return response.results.map((result) => ({
      sourceKind: 'memory',
      sourceId: result.id,
      title: result.description,
      snippet: truncate(result.content ?? result.description),
      score: result.score,
      createdAt: result.createdAt,
      workspaceId: result.workspaceId,
      projectId: result.projectId,
      runId: null,
      taskId: null,
      sessionRootId: null,
      subtype: result.type,
      status: result.revisionStatus ?? null,
      ...(result.layer ? { memoryLayer: result.layer } : {}),
      ...(result.sourceType ? { memorySourceType: result.sourceType as RecallResult['memorySourceType'] } : {}),
    }));
  }

  async search(query: RecallQuery): Promise<RecallSearchResponse> {
    const matchExpr = sanitizeFtsQuery(query.query);
    if (matchExpr === '""') {
      return {
        query: query.query,
        results: [],
        totalMatches: 0,
      };
    }

    const finalLimit = query.limit ?? 20;
    const perSourceLimit = Math.max(5, finalLimit * 3);
    const candidates: RecallResult[] = [];

    if (this.shouldSearch(query, 'receipt')) {
      candidates.push(...this.searchReceipts(query, matchExpr, perSourceLimit));
    }
    if (this.shouldSearch(query, 'run_event')) {
      candidates.push(...this.searchRunEvents(query, matchExpr, perSourceLimit));
    }
    if (this.shouldSearch(query, 'message')) {
      candidates.push(...this.searchMessages(query, matchExpr, perSourceLimit));
    }
    if (this.shouldSearch(query, 'message_ingress')) {
      candidates.push(...this.searchMessageIngress(query, matchExpr, perSourceLimit));
    }
    if (this.shouldSearch(query, 'intervention')) {
      candidates.push(...this.searchInterventions(query, matchExpr, perSourceLimit));
    }
    if (this.shouldSearch(query, 'memory')) {
      candidates.push(...await this.searchMemory(query, perSourceLimit));
    }

    const results = candidates
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        const createdDiff = Date.parse(right.createdAt) - Date.parse(left.createdAt);
        if (createdDiff !== 0) return createdDiff;
        if (left.sourceKind !== right.sourceKind) return left.sourceKind.localeCompare(right.sourceKind);
        return left.sourceId.localeCompare(right.sourceId);
      })
      .slice(0, finalLimit);

    return {
      query: query.query,
      results,
      totalMatches: candidates.length,
    };
  }

  getDetail(kind: RecallSourceKind, id: string): RecallDetail | null {
    if (kind === 'memory') {
      const memory = this.getMemoryFn(id);
      if (!memory) return null;
      return {
        sourceKind: 'memory',
        sourceId: memory.id,
        title: memory.description,
        snippet: truncate(memory.content),
        score: 1,
        createdAt: memory.createdAt,
        workspaceId: memory.workspaceId,
        projectId: memory.projectId,
        runId: memory.sourceRunId,
        taskId: null,
        sessionRootId: null,
        subtype: memory.memoryType,
        status: null,
        content: memory.content,
        memorySourceType: memory.sourceType,
        metadata: {
          classification: memory.classification,
          scope: memory.scope,
          durable: String(memory.durable),
          confidence: String(memory.confidence),
        },
      };
    }

    const row = this.lookupAppDetail(kind, id);
    if (!row) return null;
    return {
      ...mapAppRow(kind, { query: '', limit: 1 }, row),
      content: row.content,
      metadata: {
        ...(row.subtype ? { subtype: row.subtype } : {}),
        ...(row.status ? { status: row.status } : {}),
      },
    };
  }

  private lookupAppDetail(kind: Exclude<RecallSourceKind, 'memory'>, id: string): AppRecallRow | null {
    switch (kind) {
      case 'receipt':
        return (this.db.prepare(`
          SELECT
            r.id AS source_id,
            r.summary AS title,
            COALESCE(NULLIF(r.details, ''), r.summary) AS content,
            r.created_at,
            r.workspace_id,
            t.project_id,
            r.run_id,
            r.task_id,
            run.session_root_id,
            r.status AS subtype,
            r.status,
            0 AS raw_rank
          FROM receipts r
          LEFT JOIN tasks t ON t.id = r.task_id
          LEFT JOIN runs run ON run.id = r.run_id
          WHERE r.id = ?
        `).get(id) as AppRecallRow | undefined) ?? null;
      case 'run_event':
        return (this.db.prepare(`
          SELECT
            re.id AS source_id,
            ('Run event: ' || re.type) AS title,
            re.payload AS content,
            re.created_at,
            r.workspace_id,
            t.project_id,
            re.run_id,
            r.task_id,
            r.session_root_id,
            re.type AS subtype,
            r.state AS status,
            0 AS raw_rank
          FROM run_events re
          JOIN runs r ON r.id = re.run_id
          LEFT JOIN tasks t ON t.id = r.task_id
          WHERE re.id = ?
        `).get(id) as AppRecallRow | undefined) ?? null;
      case 'message':
        return (this.db.prepare(`
          SELECT
            m.id AS source_id,
            ('Message from ' || m.sender_id) AS title,
            m.body AS content,
            m.created_at,
            COALESCE(mi.workspace_id, r.workspace_id) AS workspace_id,
            t.project_id,
            COALESCE(m.related_run_id, mi.run_id) AS run_id,
            COALESCE(mi.task_id, r.task_id) AS task_id,
            r.session_root_id,
            m.source AS subtype,
            CASE WHEN m.accepted = 1 THEN 'accepted' ELSE 'rejected' END AS status,
            0 AS raw_rank
          FROM messages m
          LEFT JOIN message_ingress mi ON mi.message_id = m.id
          LEFT JOIN runs r ON r.id = COALESCE(m.related_run_id, mi.run_id)
          LEFT JOIN tasks t ON t.id = COALESCE(mi.task_id, r.task_id)
          WHERE m.id = ?
        `).get(id) as AppRecallRow | undefined) ?? null;
      case 'message_ingress':
        return (this.db.prepare(`
          SELECT
            mi.id AS source_id,
            ('Ingress: ' || mi.decision_code) AS title,
            (mi.body || '\n\nDecision: ' || mi.decision_reason) AS content,
            mi.created_at,
            mi.workspace_id,
            t.project_id,
            mi.run_id,
            mi.task_id,
            r.session_root_id,
            mi.source AS subtype,
            CASE WHEN mi.accepted = 1 THEN 'accepted' ELSE mi.decision_code END AS status,
            0 AS raw_rank
          FROM message_ingress mi
          LEFT JOIN tasks t ON t.id = mi.task_id
          LEFT JOIN runs r ON r.id = mi.run_id
          WHERE mi.id = ?
        `).get(id) as AppRecallRow | undefined) ?? null;
      case 'intervention':
        return (this.db.prepare(`
          SELECT
            i.id AS source_id,
            ('Intervention: ' || i.code) AS title,
            COALESCE(i.resolution_note || '\n\n', '') || i.reason AS content,
            i.created_at,
            r.workspace_id,
            t.project_id,
            i.run_id,
            r.task_id,
            r.session_root_id,
            i.code AS subtype,
            i.status,
            0 AS raw_rank
          FROM interventions i
          LEFT JOIN runs r ON r.id = i.run_id
          LEFT JOIN tasks t ON t.id = r.task_id
          WHERE i.id = ?
        `).get(id) as AppRecallRow | undefined) ?? null;
    }
  }
}
