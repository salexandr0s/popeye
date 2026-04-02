import Foundation

public struct MedicalService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadImports() async throws -> [MedicalImportDTO] {
        try await client.listMedicalImports()
    }

    public func loadVaults() async throws -> [VaultRecordDTO] {
        try await client.listVaults(domain: "medical")
    }

    public func openVault(id: String, requestedBy: String = "operator-ui") async throws -> VaultRecordDTO {
        let approval = try await client.createApproval(input: ApprovalRequestInput(
            scope: "vault_open",
            domain: "medical",
            riskClass: "ask",
            actionKind: "open",
            resourceScope: "resource",
            resourceType: "vault",
            resourceId: id,
            requestedBy: requestedBy,
            payloadPreview: "Open medical vault \(id)"
        ))
        let resolved = try await client.resolveApproval(id: approval.id, decision: "approved", reason: "Opened from the macOS client")
        return try await client.openVault(id: id, approvalId: resolved.id)
    }

    public func closeVault(id: String) async throws -> VaultRecordDTO {
        try await client.closeVault(id: id)
    }

    public func loadAppointments(importId: String? = nil, limit: Int? = nil) async throws -> [MedicalAppointmentDTO] {
        try await client.listMedicalAppointments(importId: importId, limit: limit)
    }

    public func loadMedications(importId: String? = nil) async throws -> [MedicalMedicationDTO] {
        try await client.listMedicalMedications(importId: importId)
    }

    public func loadDocuments(importId: String? = nil) async throws -> [MedicalDocumentDTO] {
        try await client.listMedicalDocuments(importId: importId)
    }

    public func search(query: String, limit: Int = 20) async throws -> MedicalSearchResponseDTO {
        try await client.searchMedical(query: query, limit: limit)
    }

    public func loadDigest(period: String? = nil) async throws -> MedicalDigestDTO? {
        try await client.medicalDigest(period: period)
    }

    public func triggerDigest(period: String? = nil) async throws -> MedicalDigestDTO {
        try await client.triggerMedicalDigest(period: period)
    }

    public func createImport(vaultId: String, importType: String = "pdf", fileName: String) async throws -> MedicalImportDTO {
        try await client.createMedicalImport(input: MedicalImportCreateInput(vaultId: vaultId, importType: importType, fileName: fileName))
    }

    public func createAppointment(input: MedicalAppointmentCreateInput) async throws -> MedicalAppointmentDTO {
        try await client.createMedicalAppointment(input: input)
    }

    public func createMedication(input: MedicalMedicationCreateInput) async throws -> MedicalMedicationDTO {
        try await client.createMedicalMedication(input: input)
    }

    public func createDocument(input: MedicalDocumentCreateInput) async throws -> MedicalDocumentDTO {
        try await client.createMedicalDocument(input: input)
    }

    public func updateImportStatus(id: String, status: String) async throws {
        _ = try await client.updateMedicalImportStatus(id: id, input: MedicalImportStatusUpdateInput(status: status))
    }
}
