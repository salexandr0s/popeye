import type { CapabilityMigration } from '@popeye/cap-common';

export function getGithubMigrations(): CapabilityMigration[] {
  return [
    {
      id: 'github-001-accounts',
      statements: [
        `CREATE TABLE IF NOT EXISTS github_accounts (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          github_username TEXT NOT NULL,
          display_name TEXT NOT NULL,
          sync_cursor_since TEXT,
          last_sync_at TEXT,
          repo_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_github_accounts_connection ON github_accounts(connection_id);',
        'CREATE INDEX IF NOT EXISTS idx_github_accounts_username ON github_accounts(github_username);',
      ],
    },
    {
      id: 'github-002-repos',
      statements: [
        `CREATE TABLE IF NOT EXISTS github_repos (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES github_accounts(id),
          github_repo_id INTEGER NOT NULL,
          owner TEXT NOT NULL,
          name TEXT NOT NULL,
          full_name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          is_private INTEGER NOT NULL DEFAULT 0,
          is_fork INTEGER NOT NULL DEFAULT 0,
          default_branch TEXT NOT NULL DEFAULT 'main',
          language TEXT,
          stars_count INTEGER NOT NULL DEFAULT 0,
          open_issues_count INTEGER NOT NULL DEFAULT 0,
          last_pushed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_github_repos_account_ghid ON github_repos(account_id, github_repo_id);',
        'CREATE INDEX IF NOT EXISTS idx_github_repos_account ON github_repos(account_id);',
      ],
    },
    {
      id: 'github-003-pull-requests',
      statements: [
        `CREATE TABLE IF NOT EXISTS github_pull_requests (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES github_accounts(id),
          repo_id TEXT NOT NULL REFERENCES github_repos(id),
          github_pr_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          body_preview TEXT NOT NULL DEFAULT '',
          author TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'open',
          is_draft INTEGER NOT NULL DEFAULT 0,
          review_decision TEXT,
          ci_status TEXT,
          head_branch TEXT NOT NULL,
          base_branch TEXT NOT NULL,
          additions INTEGER NOT NULL DEFAULT 0,
          deletions INTEGER NOT NULL DEFAULT 0,
          changed_files INTEGER NOT NULL DEFAULT 0,
          labels TEXT NOT NULL DEFAULT '[]',
          requested_reviewers TEXT NOT NULL DEFAULT '[]',
          created_at_gh TEXT NOT NULL,
          updated_at_gh TEXT NOT NULL,
          merged_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_github_prs_account_repo_number ON github_pull_requests(account_id, repo_id, github_pr_number);',
        'CREATE INDEX IF NOT EXISTS idx_github_prs_account_state ON github_pull_requests(account_id, state);',
        'CREATE INDEX IF NOT EXISTS idx_github_prs_repo ON github_pull_requests(repo_id);',
      ],
    },
    {
      id: 'github-004-issues',
      statements: [
        `CREATE TABLE IF NOT EXISTS github_issues (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES github_accounts(id),
          repo_id TEXT NOT NULL REFERENCES github_repos(id),
          github_issue_number INTEGER NOT NULL,
          title TEXT NOT NULL,
          body_preview TEXT NOT NULL DEFAULT '',
          author TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'open',
          labels TEXT NOT NULL DEFAULT '[]',
          assignees TEXT NOT NULL DEFAULT '[]',
          milestone TEXT,
          is_assigned_to_me INTEGER NOT NULL DEFAULT 0,
          is_mentioned INTEGER NOT NULL DEFAULT 0,
          created_at_gh TEXT NOT NULL,
          updated_at_gh TEXT NOT NULL,
          closed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_github_issues_account_repo_number ON github_issues(account_id, repo_id, github_issue_number);',
        'CREATE INDEX IF NOT EXISTS idx_github_issues_account_state ON github_issues(account_id, state);',
        'CREATE INDEX IF NOT EXISTS idx_github_issues_repo ON github_issues(repo_id);',
        'CREATE INDEX IF NOT EXISTS idx_github_issues_assigned ON github_issues(account_id, is_assigned_to_me);',
      ],
    },
    {
      id: 'github-005-notifications',
      statements: [
        `CREATE TABLE IF NOT EXISTS github_notifications (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES github_accounts(id),
          github_notification_id TEXT NOT NULL,
          repo_full_name TEXT NOT NULL,
          subject_title TEXT NOT NULL,
          subject_type TEXT NOT NULL,
          reason TEXT NOT NULL,
          is_unread INTEGER NOT NULL DEFAULT 1,
          updated_at_gh TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_github_notifications_account_ghid ON github_notifications(account_id, github_notification_id);',
        'CREATE INDEX IF NOT EXISTS idx_github_notifications_account_unread ON github_notifications(account_id, is_unread);',
      ],
    },
    {
      id: 'github-006-digests',
      statements: [
        `CREATE TABLE IF NOT EXISTS github_digests (
          id TEXT PRIMARY KEY,
          account_id TEXT NOT NULL REFERENCES github_accounts(id),
          workspace_id TEXT NOT NULL,
          date TEXT NOT NULL,
          open_prs_count INTEGER NOT NULL DEFAULT 0,
          review_requests_count INTEGER NOT NULL DEFAULT 0,
          assigned_issues_count INTEGER NOT NULL DEFAULT 0,
          unread_notifications_count INTEGER NOT NULL DEFAULT 0,
          summary_markdown TEXT NOT NULL DEFAULT '',
          generated_at TEXT NOT NULL
        );`,
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_github_digests_account_date ON github_digests(account_id, date);',
      ],
    },
    {
      id: 'github-007-fts',
      statements: [
        // FTS5 on pull requests
        `CREATE VIRTUAL TABLE IF NOT EXISTS github_pull_requests_fts USING fts5(
          title,
          body_preview,
          content=github_pull_requests,
          content_rowid=rowid
        );`,
        `CREATE TRIGGER IF NOT EXISTS github_prs_ai AFTER INSERT ON github_pull_requests BEGIN
          INSERT INTO github_pull_requests_fts(rowid, title, body_preview) VALUES (new.rowid, new.title, new.body_preview);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS github_prs_ad AFTER DELETE ON github_pull_requests BEGIN
          INSERT INTO github_pull_requests_fts(github_pull_requests_fts, rowid, title, body_preview) VALUES('delete', old.rowid, old.title, old.body_preview);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS github_prs_au AFTER UPDATE ON github_pull_requests BEGIN
          INSERT INTO github_pull_requests_fts(github_pull_requests_fts, rowid, title, body_preview) VALUES('delete', old.rowid, old.title, old.body_preview);
          INSERT INTO github_pull_requests_fts(rowid, title, body_preview) VALUES (new.rowid, new.title, new.body_preview);
        END;`,
        // FTS5 on issues
        `CREATE VIRTUAL TABLE IF NOT EXISTS github_issues_fts USING fts5(
          title,
          body_preview,
          content=github_issues,
          content_rowid=rowid
        );`,
        `CREATE TRIGGER IF NOT EXISTS github_issues_ai AFTER INSERT ON github_issues BEGIN
          INSERT INTO github_issues_fts(rowid, title, body_preview) VALUES (new.rowid, new.title, new.body_preview);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS github_issues_ad AFTER DELETE ON github_issues BEGIN
          INSERT INTO github_issues_fts(github_issues_fts, rowid, title, body_preview) VALUES('delete', old.rowid, old.title, old.body_preview);
        END;`,
        `CREATE TRIGGER IF NOT EXISTS github_issues_au AFTER UPDATE ON github_issues BEGIN
          INSERT INTO github_issues_fts(github_issues_fts, rowid, title, body_preview) VALUES('delete', old.rowid, old.title, old.body_preview);
          INSERT INTO github_issues_fts(rowid, title, body_preview) VALUES (new.rowid, new.title, new.body_preview);
        END;`,
      ],
    },
  ];
}
