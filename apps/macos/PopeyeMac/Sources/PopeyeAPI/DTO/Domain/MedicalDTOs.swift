import Foundation

public struct MedicalImportDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let vaultId: String
    public let importType: String
    public let fileName: String
    public let status: String
    public let importedAt: String
}

public struct MedicalAppointmentDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let importId: String
    public let date: String
    public let provider: String
    public let specialty: String?
    public let location: String?
    public let redactedSummary: String
}

public struct MedicalMedicationDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let importId: String
    public let name: String
    public let dosage: String?
    public let frequency: String?
    public let prescriber: String?
    public let startDate: String?
    public let endDate: String?
    public let redactedSummary: String
}

public struct MedicalDocumentDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let importId: String
    public let fileName: String
    public let mimeType: String
    public let sizeBytes: Int
    public let redactedSummary: String
}

public struct MedicalDigestDTO: Codable, Sendable, Identifiable, Equatable {
    public let id: String
    public let period: String
    public let appointmentCount: Int
    public let activeMedications: Int
    public let summary: String
    public let generatedAt: String
}

public struct MedicalSearchResultDTO: Codable, Sendable, Identifiable, Equatable {
    public var id: String { recordId }
    public let recordId: String
    public let recordType: String
    public let date: String?
    public let redactedSummary: String
    public let score: Double
}

public struct MedicalSearchResponseDTO: Codable, Sendable, Equatable {
    public let query: String
    public let results: [MedicalSearchResultDTO]
}

public struct MedicalDigestTriggerInput: Encodable, Sendable {
    public let period: String?

    public init(period: String? = nil) {
        self.period = period
    }
}

public struct MedicalImportCreateInput: Encodable, Sendable {
    public let vaultId: String
    public let importType: String
    public let fileName: String

    public init(vaultId: String, importType: String = "pdf", fileName: String) {
        self.vaultId = vaultId
        self.importType = importType
        self.fileName = fileName
    }
}

public struct MedicalAppointmentCreateInput: Encodable, Sendable {
    public let importId: String
    public let date: String
    public let provider: String
    public let specialty: String?
    public let location: String?
    public let redactedSummary: String

    public init(
        importId: String,
        date: String,
        provider: String,
        specialty: String? = nil,
        location: String? = nil,
        redactedSummary: String = ""
    ) {
        self.importId = importId
        self.date = date
        self.provider = provider
        self.specialty = specialty
        self.location = location
        self.redactedSummary = redactedSummary
    }
}

public struct MedicalMedicationCreateInput: Encodable, Sendable {
    public let importId: String
    public let name: String
    public let dosage: String?
    public let frequency: String?
    public let prescriber: String?
    public let startDate: String?
    public let endDate: String?
    public let redactedSummary: String

    public init(
        importId: String,
        name: String,
        dosage: String? = nil,
        frequency: String? = nil,
        prescriber: String? = nil,
        startDate: String? = nil,
        endDate: String? = nil,
        redactedSummary: String = ""
    ) {
        self.importId = importId
        self.name = name
        self.dosage = dosage
        self.frequency = frequency
        self.prescriber = prescriber
        self.startDate = startDate
        self.endDate = endDate
        self.redactedSummary = redactedSummary
    }
}

public struct MedicalDocumentCreateInput: Encodable, Sendable {
    public let importId: String
    public let fileName: String
    public let mimeType: String
    public let sizeBytes: Int
    public let redactedSummary: String

    public init(
        importId: String,
        fileName: String,
        mimeType: String,
        sizeBytes: Int,
        redactedSummary: String = ""
    ) {
        self.importId = importId
        self.fileName = fileName
        self.mimeType = mimeType
        self.sizeBytes = sizeBytes
        self.redactedSummary = redactedSummary
    }
}

public struct MedicalImportStatusUpdateInput: Encodable, Sendable {
    public let status: String

    public init(status: String) {
        self.status = status
    }
}
