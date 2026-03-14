import type {
  DbConnection,
  RuntimePaths,
  WorkspaceRecord,
  ProjectRecord,
  WorkspaceRegistrationInput,
  ProjectRegistrationInput,
} from '@popeye/contracts';
import {
  WorkspaceRecordSchema,
  ProjectRecordSchema,
  WorkspaceRegistrationInputSchema,
  ProjectRegistrationInputSchema,
  nowIso,
} from '@popeye/contracts';

export interface WorkspaceDeps {
  app: DbConnection;
  paths: RuntimePaths;
}

export class WorkspaceRegistry {
  constructor(private readonly deps: WorkspaceDeps) {}

  registerWorkspace(input: WorkspaceRegistrationInput): WorkspaceRecord {
    const parsed = WorkspaceRegistrationInputSchema.parse(input);
    const now = nowIso();
    this.deps.app
      .prepare('INSERT OR REPLACE INTO workspaces (id, name, root_path, created_at) VALUES (?, ?, ?, ?)')
      .run(parsed.id, parsed.name, parsed.rootPath, now);
    return { id: parsed.id, name: parsed.name, rootPath: parsed.rootPath, createdAt: now };
  }

  registerProject(input: ProjectRegistrationInput): ProjectRecord {
    const parsed = ProjectRegistrationInputSchema.parse(input);
    const workspace = this.getWorkspace(parsed.workspaceId);
    if (!workspace) throw new Error(`Workspace ${parsed.workspaceId} not found`);
    const now = nowIso();
    this.deps.app
      .prepare('INSERT OR REPLACE INTO projects (id, workspace_id, name, path, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(parsed.id, parsed.workspaceId, parsed.name, parsed.path, now);
    return { id: parsed.id, workspaceId: parsed.workspaceId, name: parsed.name, path: parsed.path, createdAt: now };
  }

  listWorkspaces(): WorkspaceRecord[] {
    const rows = this.deps.app
      .prepare('SELECT * FROM workspaces ORDER BY created_at ASC')
      .all() as Array<Record<string, string | null>>;
    return rows.map((row) =>
      WorkspaceRecordSchema.parse({
        id: row.id,
        name: row.name,
        rootPath: row.root_path ?? null,
        createdAt: row.created_at,
      }),
    );
  }

  getWorkspace(id: string): WorkspaceRecord | null {
    const row = this.deps.app
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(id) as Record<string, string | null> | undefined;
    if (!row) return null;
    return WorkspaceRecordSchema.parse({
      id: row.id,
      name: row.name,
      rootPath: row.root_path ?? null,
      createdAt: row.created_at,
    });
  }

  listProjects(): ProjectRecord[] {
    const rows = this.deps.app
      .prepare('SELECT * FROM projects ORDER BY created_at ASC')
      .all() as Array<Record<string, string | null>>;
    return rows.map((row) =>
      ProjectRecordSchema.parse({
        id: row.id,
        workspaceId: row.workspace_id,
        name: row.name,
        path: row.path ?? null,
        createdAt: row.created_at,
      }),
    );
  }

  getProject(id: string): ProjectRecord | null {
    const row = this.deps.app
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as Record<string, string | null> | undefined;
    if (!row) return null;
    return ProjectRecordSchema.parse({
      id: row.id,
      workspaceId: row.workspace_id,
      name: row.name,
      path: row.path ?? null,
      createdAt: row.created_at,
    });
  }
}
