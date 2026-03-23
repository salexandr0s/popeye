import Foundation

public struct EngineCapabilitiesDTO: Codable, Sendable {
    public let engineKind: String
    public let persistentSessionSupport: Bool
    public let resumeBySessionRefSupport: Bool
    public let hostToolMode: String
    public let compactionEventSupport: Bool
    public let cancellationMode: String
    public let acceptedRequestMetadata: [String]
    public let warnings: [String]
}
