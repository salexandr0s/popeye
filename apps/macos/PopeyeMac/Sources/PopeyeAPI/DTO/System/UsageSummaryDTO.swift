import Foundation

public struct UsageSummaryDTO: Codable, Sendable {
    public let runs: Int
    public let tokensIn: Int
    public let tokensOut: Int
    public let estimatedCostUsd: Double
}
