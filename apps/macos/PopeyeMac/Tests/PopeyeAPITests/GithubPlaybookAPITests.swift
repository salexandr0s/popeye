import Foundation
import Testing

@testable import PopeyeAPI

@Suite("GitHub API Surface")
struct GithubAPITests {
    let decoder = ResponseDecoder.makeDecoder()

    @Test("GitHub endpoints encode list, search, and mutation paths")
    func githubEndpoints() {
        let repos = Endpoint.githubRepos(accountId: "gh-account-1", limit: 30)
        let pullRequests = Endpoint.githubPullRequests(accountId: "gh-account-1", state: "open", limit: 10)
        let issues = Endpoint.githubIssues(accountId: "gh-account-1", state: "open", assigned: true, limit: 15)
        let notifications = Endpoint.githubNotifications(accountId: "gh-account-1", limit: 20)
        let digest = Endpoint.githubDigest(accountId: "gh-account-1")
        let search = Endpoint.githubSearch(query: "compiler", accountId: "gh-account-1", entityType: "pr", limit: 12)

        #expect(Endpoint.githubAccounts.path == "/v1/github/accounts")
        #expect(repos.path == "/v1/github/repos")
        #expect(repos.queryItems.contains(URLQueryItem(name: "accountId", value: "gh-account-1")))
        #expect(repos.queryItems.contains(URLQueryItem(name: "limit", value: "30")))
        #expect(pullRequests.path == "/v1/github/prs")
        #expect(pullRequests.queryItems.contains(URLQueryItem(name: "state", value: "open")))
        #expect(Endpoint.githubPullRequest(id: "pr-1").path == "/v1/github/prs/pr-1")
        #expect(issues.path == "/v1/github/issues")
        #expect(issues.queryItems.contains(URLQueryItem(name: "assigned", value: "true")))
        #expect(Endpoint.githubIssue(id: "issue-1").path == "/v1/github/issues/issue-1")
        #expect(notifications.path == "/v1/github/notifications")
        #expect(digest.path == "/v1/github/digest")
        #expect(search.path == "/v1/github/search")
        #expect(search.queryItems.contains(URLQueryItem(name: "query", value: "compiler")))
        #expect(search.queryItems.contains(URLQueryItem(name: "entityType", value: "pr")))
        #expect(Endpoint.syncGithub.method == .post)
        #expect(Endpoint.createGithubComment.path == "/v1/github/comments")
        #expect(Endpoint.markGithubNotificationRead.path == "/v1/github/notifications/mark-read")
    }

    @Test("Decode GitHub DTOs from inline JSON")
    func decodeGithubDTOs() throws {
        let account = try decoder.decode(
            GithubAccountDTO.self,
            from: Data(
                """
                {
                  "id": "gh-account-1",
                  "connectionId": "conn-gh-1",
                  "githubUsername": "octocat",
                  "displayName": "Octo Cat",
                  "syncCursorSince": null,
                  "lastSyncAt": "2026-04-08T08:00:00Z",
                  "repoCount": 3,
                  "createdAt": "2026-04-01T08:00:00Z",
                  "updatedAt": "2026-04-08T08:00:00Z"
                }
                """.utf8)
        )
        let pullRequest = try decoder.decode(
            GithubPullRequestDTO.self,
            from: Data(
                """
                {
                  "id": "gh-pr-1",
                  "accountId": "gh-account-1",
                  "repoId": "gh-repo-1",
                  "githubPrNumber": 42,
                  "title": "Improve compiler indexing",
                  "bodyPreview": "Ships a safer compile pipeline.",
                  "author": "octocat",
                  "state": "open",
                  "isDraft": false,
                  "reviewDecision": "approved",
                  "ciStatus": "success",
                  "headBranch": "feature/compiler",
                  "baseBranch": "main",
                  "additions": 50,
                  "deletions": 12,
                  "changedFiles": 4,
                  "labels": ["knowledge"],
                  "requestedReviewers": ["nb"],
                  "createdAtGh": "2026-04-07T08:00:00Z",
                  "updatedAtGh": "2026-04-08T08:00:00Z",
                  "mergedAt": null,
                  "createdAt": "2026-04-07T08:00:00Z",
                  "updatedAt": "2026-04-08T08:00:00Z"
                }
                """.utf8)
        )
        let search = try decoder.decode(
            GithubSearchResponseDTO.self,
            from: Data(
                """
                {
                  "query": "compiler",
                  "results": [
                    {
                      "entityType": "pr",
                      "entityId": "gh-pr-1",
                      "repoFullName": "nb/popeye",
                      "number": 42,
                      "title": "Improve compiler indexing",
                      "author": "octocat",
                      "state": "open",
                      "updatedAt": "2026-04-08T08:00:00Z",
                      "score": 0.91
                    }
                  ]
                }
                """.utf8)
        )

        #expect(account.githubUsername == "octocat")
        #expect(pullRequest.reviewDecision == "approved")
        #expect(search.results.first?.entityId == "gh-pr-1")
    }
}

@Suite("Playbook API Surface")
struct PlaybookAPITests {
    let decoder = ResponseDecoder.makeDecoder()

    @Test("Playbook endpoints encode list and action paths")
    func playbookEndpoints() {
        let playbooks = Endpoint.playbooks(q: "triage", scope: "workspace", workspaceId: "default", status: "active", limit: 25, offset: 5)
        let usage = Endpoint.playbookUsage(id: "workspace:default:triage", limit: 10, offset: 2)
        let proposals = Endpoint.playbookProposals(q: "repair", status: "pending_review", kind: "patch", scope: "workspace", targetRecordId: "workspace:default:triage", sort: "created_desc", limit: 20, offset: 0)

        #expect(playbooks.path == "/v1/playbooks")
        #expect(playbooks.queryItems.contains(URLQueryItem(name: "q", value: "triage")))
        #expect(playbooks.queryItems.contains(URLQueryItem(name: "scope", value: "workspace")))
        #expect(playbooks.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
        #expect(playbooks.queryItems.contains(URLQueryItem(name: "status", value: "active")))
        #expect(Endpoint.playbook(id: "workspace:default:triage").path == "/v1/playbooks/workspace:default:triage")
        #expect(Endpoint.playbookStaleCandidates.path == "/v1/playbooks/stale-candidates")
        #expect(Endpoint.playbookRevisions(id: "workspace:default:triage").path == "/v1/playbooks/workspace:default:triage/revisions")
        #expect(usage.queryItems.contains(URLQueryItem(name: "offset", value: "2")))
        #expect(proposals.path == "/v1/playbook-proposals")
        #expect(proposals.queryItems.contains(URLQueryItem(name: "kind", value: "patch")))
        #expect(proposals.queryItems.contains(URLQueryItem(name: "targetRecordId", value: "workspace:default:triage")))
        #expect(Endpoint.playbookProposal(id: "proposal-1").path == "/v1/playbook-proposals/proposal-1")
        #expect(Endpoint.createPlaybookProposal.method == .post)
        #expect(Endpoint.reviewPlaybookProposal(id: "proposal-1").path == "/v1/playbook-proposals/proposal-1/review")
        #expect(Endpoint.updatePlaybookProposal(id: "proposal-1").method == .patch)
        #expect(Endpoint.submitPlaybookProposalForReview(id: "proposal-1").path == "/v1/playbook-proposals/proposal-1/submit-review")
        #expect(Endpoint.applyPlaybookProposal(id: "proposal-1").path == "/v1/playbook-proposals/proposal-1/apply")
        #expect(Endpoint.suggestPlaybookPatch(id: "workspace:default:triage").path == "/v1/playbooks/workspace:default:triage/suggest-patch")
        #expect(Endpoint.activatePlaybook(id: "workspace:default:triage").path == "/v1/playbooks/workspace:default:triage/activate")
        #expect(Endpoint.retirePlaybook(id: "workspace:default:triage").path == "/v1/playbooks/workspace:default:triage/retire")
        #expect(Endpoint.projects.path == "/v1/projects")
    }

    @Test("Decode playbook DTOs from inline JSON")
    func decodePlaybookDTOs() throws {
        let project = try decoder.decode(
            ProjectRecordDTO.self,
            from: Data(
                """
                {
                  "id": "proj-1",
                  "workspaceId": "default",
                  "name": "Project One",
                  "path": "/tmp/default/project-one",
                  "createdAt": "2026-04-02T08:00:00Z"
                }
                """.utf8)
        )
        let detail = try decoder.decode(
            PlaybookDetailDTO.self,
            from: Data(
                """
                {
                  "recordId": "workspace:default:triage",
                  "playbookId": "triage",
                  "scope": "workspace",
                  "workspaceId": "default",
                  "projectId": null,
                  "title": "Workspace triage",
                  "status": "active",
                  "allowedProfileIds": ["default"],
                  "filePath": "playbooks/workspace/triage.md",
                  "currentRevisionHash": "rev-1",
                  "createdAt": "2026-04-01T08:00:00Z",
                  "updatedAt": "2026-04-08T08:00:00Z",
                  "effectiveness": {
                    "useCount30d": 14,
                    "succeededRuns30d": 12,
                    "failedRuns30d": 1,
                    "intervenedRuns30d": 1,
                    "successRate30d": 0.86,
                    "failureRate30d": 0.07,
                    "interventionRate30d": 0.07,
                    "lastUsedAt": "2026-04-08T07:00:00Z",
                    "lastUpdatedAt": "2026-04-08T08:00:00Z"
                  },
                  "body": "Canonical instructions",
                  "markdownText": "# Workspace triage\\n\\nCanonical instructions",
                  "indexedMemoryId": "memory-1"
                }
                """.utf8)
        )
        let proposal = try decoder.decode(
            PlaybookProposalDTO.self,
            from: Data(
                """
                {
                  "id": "proposal-1",
                  "kind": "patch",
                  "status": "pending_review",
                  "targetRecordId": "workspace:default:triage",
                  "baseRevisionHash": "rev-1",
                  "playbookId": "triage",
                  "scope": "workspace",
                  "workspaceId": "default",
                  "projectId": null,
                  "title": "Triage repair",
                  "proposedStatus": "active",
                  "allowedProfileIds": ["default"],
                  "summary": "Repair stale steps",
                  "body": "Updated patch body",
                  "markdownText": "# Triage repair\\n\\nUpdated patch body",
                  "diffPreview": "+ Improve repair wording",
                  "contentHash": "content-1",
                  "revisionHash": "rev-2",
                  "scanVerdict": "allow",
                  "scanMatchedRules": [],
                  "sourceRunId": "run-1",
                  "proposedBy": "runtime_tool",
                  "evidence": {
                    "runIds": ["run-1"],
                    "interventionIds": ["int-1"],
                    "lastProblemAt": "2026-04-08T07:00:00Z",
                    "metrics30d": {
                      "useCount30d": 10,
                      "failedRuns30d": 2,
                      "interventions30d": 1
                    },
                    "suggestedPatchNote": "Repeated repair failures"
                  },
                  "reviewedBy": null,
                  "reviewedAt": null,
                  "reviewNote": null,
                  "appliedRecordId": null,
                  "appliedRevisionHash": null,
                  "appliedAt": null,
                  "createdAt": "2026-04-08T08:00:00Z",
                  "updatedAt": "2026-04-08T08:00:00Z"
                }
                """.utf8)
        )

        #expect(project.workspaceId == "default")
        #expect(detail.effectiveness?.useCount30d == 14)
        #expect(proposal.kind == "patch")
        #expect(proposal.evidence?.metrics30d.failedRuns30d == 2)
    }
}
