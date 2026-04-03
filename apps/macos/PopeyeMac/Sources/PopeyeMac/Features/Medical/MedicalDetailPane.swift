import SwiftUI
import PopeyeAPI

struct MedicalDetailPane: View {
    @Bindable var store: MedicalStore
    let showImportSheet: () -> Void
    let showAppointmentSheet: () -> Void
    let showMedicationSheet: () -> Void
    let showDocumentSheet: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                OperationStatusView(
                    phase: store.selectionPhase,
                    loadingTitle: "Refreshing import details…",
                    failureTitle: "Couldn’t refresh the selected import",
                    retryAction: { Task { await store.reloadSelection() } }
                )
                VaultStatusSection(
                    vaults: store.vaults,
                    primaryVaultAvailable: store.primaryVault != nil,
                    isMutating: store.isMutating,
                    openVault: { Task { await store.openVault() } },
                    closeVault: { Task { await store.closeVault() } }
                )
                MedicalOverviewSection(digest: store.digest)
                MedicalSearchSection(
                    searchText: $store.searchText,
                    searchResults: store.searchResults,
                    phase: store.searchPhase,
                    search: { Task { await store.search() } }
                )
                MedicalQuickActionsSection(
                    isMutating: store.isMutating,
                    hasVaults: store.vaults.isEmpty == false,
                    hasActiveImport: store.activeImport != nil,
                    regenerateDigest: { Task { await store.triggerDigest() } },
                    createImport: showImportSheet,
                    addAppointment: showAppointmentSheet,
                    addMedication: showMedicationSheet,
                    addDocument: showDocumentSheet
                )
                MedicalSelectedImportSection(
                    activeImport: store.activeImport,
                    isMutating: store.isMutating,
                    updateStatus: { status in
                        Task { await store.updateImportStatus(status) }
                    }
                )
                MedicalAppointmentsSection(appointments: store.appointments)
                MedicalMedicationsSection(medications: store.medications)
                MedicalDocumentsSection(documents: store.documents)
            }
            .padding(PopeyeUI.contentPadding)
        }
    }
}
