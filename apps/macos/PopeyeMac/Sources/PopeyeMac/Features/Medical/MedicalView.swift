import SwiftUI
import PopeyeAPI

struct MedicalView: View {
    @Bindable var store: MedicalStore
    @State private var isPresentingImportSheet = false
    @State private var isPresentingAppointmentSheet = false
    @State private var isPresentingMedicationSheet = false
    @State private var isPresentingDocumentSheet = false

    var body: some View {
        Group {
            if store.isLoading && store.imports.isEmpty && store.vaults.isEmpty {
                LoadingStateView(title: "Loading medical…")
            } else if let error = store.error, store.imports.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    MedicalSidebar(store: store)
                        .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
                    MedicalDetailPane(
                        store: store,
                        showImportSheet: { isPresentingImportSheet = true },
                        showAppointmentSheet: { isPresentingAppointmentSheet = true },
                        showMedicationSheet: { isPresentingMedicationSheet = true },
                        showDocumentSheet: { isPresentingDocumentSheet = true }
                    )
                    .frame(minWidth: 620)
                }
                .overlay(alignment: .bottomTrailing) {
                    MutationStateOverlay(
                        state: store.mutationState,
                        dismiss: { store.dismissMutation() }
                    )
                    .padding(20)
                }
            }
        }
        .navigationTitle("Medical")
        .toolbar {
            ToolbarItemGroup {
                Button("New Import", systemImage: "square.and.arrow.down") {
                    isPresentingImportSheet = true
                }
                .disabled(store.vaults.isEmpty)

                Button("Add Appointment", systemImage: "calendar.badge.plus") {
                    isPresentingAppointmentSheet = true
                }
                .disabled(store.activeImport == nil)
            }
        }
        .task {
            await store.load()
        }
        .onChange(of: store.selectedImportID) { _, _ in
            Task { await store.reloadSelection() }
        }
        .onChange(of: store.searchText) { _, newValue in
            if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Task { await store.search() }
            }
        }
        .popeyeRefreshable(invalidationSignals: [.general, .security]) {
            await store.load()
        }
        .sheet(isPresented: $isPresentingImportSheet) {
            MedicalImportSheet(vaults: store.vaults) { vaultId, importType, fileName in
                Task { await store.createImport(vaultId: vaultId, importType: importType, fileName: fileName) }
            }
        }
        .sheet(isPresented: $isPresentingAppointmentSheet) {
            if let activeImport = store.activeImport {
                MedicalAppointmentSheet(importId: activeImport.id) { input in
                    Task { await store.createAppointment(input: input) }
                }
            }
        }
        .sheet(isPresented: $isPresentingMedicationSheet) {
            if let activeImport = store.activeImport {
                MedicalMedicationSheet(importId: activeImport.id) { input in
                    Task { await store.createMedication(input: input) }
                }
            }
        }
        .sheet(isPresented: $isPresentingDocumentSheet) {
            if let activeImport = store.activeImport {
                MedicalDocumentSheet(importId: activeImport.id) { input in
                    Task { await store.createDocument(input: input) }
                }
            }
        }
    }

    private func reload() {
        Task { await store.load() }
    }
}
