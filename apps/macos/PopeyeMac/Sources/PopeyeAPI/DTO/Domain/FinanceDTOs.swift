import Foundation

public struct FinanceImportDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let vaultId: String
    public let importType: String
    public let fileName: String
    public let status: String
    public let recordCount: Int
    public let importedAt: String
}

public struct FinanceTransactionDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let importId: String
    public let date: String
    public let description: String
    public let amount: Double
    public let currency: String
    public let category: String?
    public let merchantName: String?
    public let accountLabel: String?
    public let redactedSummary: String
}

public struct FinanceDocumentDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let importId: String
    public let fileName: String
    public let mimeType: String
    public let sizeBytes: Int
    public let redactedSummary: String
}

public struct FinanceAnomalyFlagDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { "\(severity):\(transactionId ?? description)" }
    public let description: String
    public let severity: String
    public let transactionId: String?
}

public struct FinanceDigestDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let period: String
    public let totalIncome: Double
    public let totalExpenses: Double
    public let categoryBreakdown: [String: Double]
    public let anomalyFlags: [FinanceAnomalyFlagDTO]
    public let generatedAt: String
}

public struct FinanceSearchResultDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { transactionId }
    public let transactionId: String
    public let date: String
    public let description: String
    public let amount: Double
    public let redactedSummary: String
    public let score: Double
}

public struct FinanceSearchResponseDTO: Codable, Sendable, Equatable {
    public let query: String
    public let results: [FinanceSearchResultDTO]
}

public struct FinanceDigestTriggerInput: Encodable, Sendable {
    public let period: String?

    public init(period: String? = nil) {
        self.period = period
    }
}

public struct FinanceImportCreateInput: Encodable, Sendable {
    public let vaultId: String
    public let importType: String
    public let fileName: String

    public init(vaultId: String, importType: String = "csv", fileName: String) {
        self.vaultId = vaultId
        self.importType = importType
        self.fileName = fileName
    }
}

public struct FinanceTransactionCreateInput: Encodable, Sendable {
    public let importId: String
    public let date: String
    public let description: String
    public let amount: Double
    public let currency: String
    public let category: String?
    public let merchantName: String?
    public let accountLabel: String?
    public let redactedSummary: String

    public init(
        importId: String,
        date: String,
        description: String,
        amount: Double,
        currency: String = "USD",
        category: String? = nil,
        merchantName: String? = nil,
        accountLabel: String? = nil,
        redactedSummary: String = ""
    ) {
        self.importId = importId
        self.date = date
        self.description = description
        self.amount = amount
        self.currency = currency
        self.category = category
        self.merchantName = merchantName
        self.accountLabel = accountLabel
        self.redactedSummary = redactedSummary
    }
}

public struct FinanceImportStatusUpdateInput: Encodable, Sendable {
    public let status: String
    public let recordCount: Int?

    public init(status: String, recordCount: Int? = nil) {
        self.status = status
        self.recordCount = recordCount
    }
}
