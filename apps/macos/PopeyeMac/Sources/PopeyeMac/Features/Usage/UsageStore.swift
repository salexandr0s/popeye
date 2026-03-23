import Foundation
import PopeyeAPI

@Observable @MainActor
final class UsageStore {
    enum LoadingState {
        case idle
        case loading
        case loaded
        case failed(APIError)
    }

    // MARK: - Raw Data

    var receipts: [ReceiptRecordDTO] = []
    var loadingState: LoadingState = .idle
    var lastUpdated: Date?

    // MARK: - Cached Aggregates (recomputed once per load, not per render)

    var totalCost: Double = 0
    var totalTokensIn: Int = 0
    var totalTokensOut: Int = 0
    var totalRuns: Int = 0
    var successRate: Double = 0
    var averageCostPerRun: Double = 0
    var costByDay: [DailyCost] = []
    var costByModel: [ModelUsage] = []
    var costByStatus: [StatusBreakdown] = []
    var topExpensiveRuns: [ReceiptRecordDTO] = []

    private let operationsService: OperationsService
    private let client: ControlAPIClient

    init(client: ControlAPIClient) {
        self.client = client
        self.operationsService = OperationsService(client: client)
    }

    func load() async {
        loadingState = .loading
        do {
            receipts = try await operationsService.loadReceipts()
            recompute()
            lastUpdated = .now
            loadingState = .loaded
        } catch let error as APIError {
            loadingState = .failed(error)
        } catch {
            loadingState = .failed(.transportUnavailable)
        }
    }

    func refresh() async {
        do {
            receipts = try await operationsService.loadReceipts()
            recompute()
            lastUpdated = .now
            if case .failed = loadingState {
                loadingState = .loaded
            }
        } catch {
            PopeyeLogger.refresh.error("Usage refresh failed: \(error)")
        }
    }

    // MARK: - Aggregation (runs once per data load)

    private func recompute() {
        // All aggregates derived from receipts only — consistent data source
        let count = receipts.count
        totalRuns = count
        totalCost = receipts.reduce(0) { $0 + $1.usage.estimatedCostUsd }
        totalTokensIn = receipts.reduce(0) { $0 + $1.usage.tokensIn }
        totalTokensOut = receipts.reduce(0) { $0 + $1.usage.tokensOut }

        if count > 0 {
            successRate = Double(receipts.count(where: { $0.status == "succeeded" })) / Double(count)
            averageCostPerRun = totalCost / Double(count)
        } else {
            successRate = 0
            averageCostPerRun = 0
        }

        costByDay = buildCostByDay()
        costByModel = buildCostByModel()
        costByStatus = buildCostByStatus()
        topExpensiveRuns = buildTopExpensiveRuns()
    }

    // MARK: - Aggregate Builders

    struct DailyCost: Identifiable {
        let date: Date
        let cost: Double
        let runs: Int
        var id: Date { date }
    }

    private func buildCostByDay() -> [DailyCost] {
        let calendar = Calendar.current
        var buckets: [Date: (cost: Double, runs: Int)] = [:]
        for receipt in receipts {
            guard let date = DateFormatting.parseISO8601(receipt.createdAt) else { continue }
            let day = calendar.startOfDay(for: date)
            let existing = buckets[day, default: (cost: 0, runs: 0)]
            buckets[day] = (cost: existing.cost + receipt.usage.estimatedCostUsd, runs: existing.runs + 1)
        }
        return buckets.map { DailyCost(date: $0.key, cost: $0.value.cost, runs: $0.value.runs) }
            .sorted { $0.date < $1.date }
    }

    struct ModelUsage: Identifiable {
        let model: String
        let provider: String
        let cost: Double
        let tokensIn: Int
        let tokensOut: Int
        let runs: Int
        var id: String { "\(provider)/\(model)" }
    }

    private func buildCostByModel() -> [ModelUsage] {
        var buckets: [String: (provider: String, cost: Double, tokensIn: Int, tokensOut: Int, runs: Int)] = [:]
        for receipt in receipts {
            let key = "\(receipt.usage.provider)/\(receipt.usage.model)"
            let existing = buckets[key, default: (provider: receipt.usage.provider, cost: 0, tokensIn: 0, tokensOut: 0, runs: 0)]
            buckets[key] = (
                provider: receipt.usage.provider,
                cost: existing.cost + receipt.usage.estimatedCostUsd,
                tokensIn: existing.tokensIn + receipt.usage.tokensIn,
                tokensOut: existing.tokensOut + receipt.usage.tokensOut,
                runs: existing.runs + 1
            )
        }
        return buckets.map { key, value in
            // key is "provider/model", extract model name
            let model = key.contains("/") ? String(key.split(separator: "/", maxSplits: 1).last ?? Substring(key)) : key
            return ModelUsage(model: model, provider: value.provider, cost: value.cost, tokensIn: value.tokensIn, tokensOut: value.tokensOut, runs: value.runs)
        }
        .sorted { $0.cost > $1.cost }
    }

    struct StatusBreakdown: Identifiable {
        let status: String
        let count: Int
        let cost: Double
        var id: String { status }
    }

    private func buildCostByStatus() -> [StatusBreakdown] {
        var buckets: [String: (count: Int, cost: Double)] = [:]
        for receipt in receipts {
            let existing = buckets[receipt.status, default: (count: 0, cost: 0)]
            buckets[receipt.status] = (count: existing.count + 1, cost: existing.cost + receipt.usage.estimatedCostUsd)
        }
        return buckets.map { StatusBreakdown(status: $0.key, count: $0.value.count, cost: $0.value.cost) }
            .sorted { $0.count > $1.count }
    }

    private func buildTopExpensiveRuns() -> [ReceiptRecordDTO] {
        Array(receipts.sorted { $0.usage.estimatedCostUsd > $1.usage.estimatedCostUsd }.prefix(10))
    }
}
