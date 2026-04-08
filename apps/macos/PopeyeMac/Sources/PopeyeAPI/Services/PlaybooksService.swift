import Foundation

public struct PlaybooksService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadPlaybooks(
        query: String? = nil,
        scope: String? = nil,
        workspaceId: String? = nil,
        status: String? = nil,
        limit: Int = 25,
        offset: Int = 0
    ) async throws -> [PlaybookRecordDTO] {
        try await client.listPlaybooks(
            q: query,
            scope: scope,
            workspaceId: workspaceId,
            status: status,
            limit: limit,
            offset: offset)
    }

    public func loadPlaybook(id: String) async throws -> PlaybookDetailDTO {
        try await client.getPlaybook(id: id)
    }

    public func loadRevisions(id: String) async throws -> [PlaybookRevisionDTO] {
        try await client.listPlaybookRevisions(id: id)
    }

    public func loadUsage(id: String, limit: Int = 10, offset: Int = 0) async throws
        -> [PlaybookUsageRunDTO]
    {
        try await client.listPlaybookUsage(id: id, limit: limit, offset: offset)
    }

    public func loadStaleCandidates() async throws -> [PlaybookStaleCandidateDTO] {
        try await client.listPlaybookStaleCandidates()
    }

    public func loadProposals(
        query: String? = nil,
        status: String? = nil,
        kind: String? = nil,
        scope: String? = nil,
        sort: String? = nil,
        limit: Int = 25,
        offset: Int = 0
    ) async throws -> [PlaybookProposalDTO] {
        try await client.listPlaybookProposals(
            q: query,
            status: status,
            kind: kind,
            scope: scope,
            sort: sort,
            limit: limit,
            offset: offset)
    }

    public func loadProposal(id: String) async throws -> PlaybookProposalDTO {
        try await client.getPlaybookProposal(id: id)
    }

    public func reviewProposal(id: String, decision: String, reviewedBy: String, note: String? = nil)
        async throws -> PlaybookProposalDTO
    {
        try await client.reviewPlaybookProposal(
            id: id,
            input: PlaybookProposalReviewInput(
                decision: decision,
                reviewedBy: reviewedBy,
                note: note))
    }

    public func submitProposalForReview(id: String, submittedBy: String) async throws
        -> PlaybookProposalDTO
    {
        try await client.submitPlaybookProposalForReview(
            id: id,
            input: PlaybookProposalSubmitReviewInput(submittedBy: submittedBy))
    }

    public func applyProposal(id: String, appliedBy: String) async throws -> PlaybookProposalDTO {
        try await client.applyPlaybookProposal(
            id: id,
            input: PlaybookProposalApplyInput(appliedBy: appliedBy))
    }

    public func activatePlaybook(id: String, updatedBy: String) async throws -> PlaybookDetailDTO {
        try await client.activatePlaybook(
            id: id,
            input: PlaybookLifecycleActionInput(updatedBy: updatedBy))
    }

    public func retirePlaybook(id: String, updatedBy: String) async throws -> PlaybookDetailDTO {
        try await client.retirePlaybook(
            id: id,
            input: PlaybookLifecycleActionInput(updatedBy: updatedBy))
    }
}
