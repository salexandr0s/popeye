import Foundation

public struct ExecutionEnvelopeDTO: Codable, Sendable {
    public let runId: String
    public let taskId: String
    public let profileId: String
    public let workspaceId: String
    public let projectId: String?
    public let mode: String // restricted|interactive|elevated
    public let modelPolicy: String
    public let allowedRuntimeTools: [String]
    public let allowedCapabilityIds: [String]
    public let memoryScope: String // workspace|project|global
    public let recallScope: String
    public let filesystemPolicyClass: String // workspace|project|read_only_workspace|memory_only
    public let contextReleasePolicy: String // none|summary_only|excerpt|full
    public let readRoots: [String]
    public let writeRoots: [String]
    public let protectedPaths: [String]
    public let scratchRoot: String
    public let cwd: String?
    public let provenance: ExecutionEnvelopeProvenanceDTO
}

public struct ExecutionEnvelopeProvenanceDTO: Codable, Sendable {
    public let derivedAt: String
    public let engineKind: String
    public let sessionPolicy: String // dedicated|ephemeral|per_task
    public let warnings: [String]
}
