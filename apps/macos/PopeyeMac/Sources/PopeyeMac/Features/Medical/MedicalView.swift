import SwiftUI
import PopeyeAPI

struct MedicalView: View {
    @Bindable var store: MedicalStore
    @State private var debouncer = ReloadDebouncer()
    @State private var isPresentingImportSheet = false
    @State private var isPresentingAppointmentSheet = false
    @State private var isPresentingMedicationSheet = false
    @State private var isPresentingDocumentSheet = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        Group {
            if store.isLoading && store.imports.isEmpty && store.vaults.isEmpty {
                LoadingStateView(title: "Loading medical…")
            } else if let error = store.error, store.imports.isEmpty {
                ErrorStateView(error: error, retryAction: reload)
            } else {
                HSplitView {
                    sidebar
                        .frame(minWidth: 280, idealWidth: 320, maxWidth: 360)
                    detail
                        .frame(minWidth: 620)
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
        .task { await store.load() }
        .onChange(of: store.selectedImportID) { _, _ in
            Task { await store.reloadSelection() }
        }
        .onChange(of: store.searchText) { _, newValue in
            if newValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Task { await store.search() }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            if let signal = notification.object as? InvalidationSignal, [.general, .security].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
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

    private var sidebar: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Restricted vault")
                    .font(.headline)
                Text(store.vaults.first?.encrypted == true ? "Encrypted at rest" : "Encryption not reported")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(16)

            Divider()

            if store.imports.isEmpty {
                EmptyStateView(icon: "cross.case", title: "No medical imports", description: "Medical records will appear here once vault data is ingested.")
            } else {
                List(store.imports, selection: $store.selectedImportID) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(entry.fileName)
                                .font(.headline)
                            Spacer()
                            StatusBadge(state: entry.status)
                        }
                        Text(entry.importType.replacingOccurrences(of: "_", with: " ").capitalized)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(DateFormatting.formatAbsoluteTime(entry.importedAt))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                    .tag(entry.id)
                }
                .listStyle(.sidebar)
            }
        }
    }

    private var detail: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                mutationBanner
                vaultSection

                if let digest = store.digest {
                    LazyVGrid(columns: columns, spacing: 12) {
                        DashboardCard(label: "Appointments", value: "\(digest.appointmentCount)", description: digest.period)
                        DashboardCard(label: "Medications", value: "\(digest.activeMedications)", description: digest.period)
                        DashboardCard(label: "Digest", value: "Current", description: digest.summary, valueColor: .green)
                    }
                }

                InspectorSection(title: "Search") {
                    HStack(spacing: 8) {
                        TextField("Search medical records", text: $store.searchText)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { Task { await store.search() } }
                        Button("Search") { Task { await store.search() } }
                            .buttonStyle(.borderedProminent)
                    }
                    if store.searchResults.isEmpty == false {
                        ForEach(store.searchResults) { result in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.recordType.replacingOccurrences(of: "_", with: " ").capitalized)
                                    .font(.headline)
                                Text(result.redactedSummary)
                                    .foregroundStyle(.secondary)
                                Text(result.date.map(DateFormatting.formatAbsoluteTime) ?? "No date")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                InspectorSection(title: "Quick Actions") {
                    HStack(spacing: 8) {
                        Button("Regenerate Digest") {
                            Task { await store.triggerDigest() }
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(store.isMutating)

                        Button("Create Import") {
                            isPresentingImportSheet = true
                        }
                        .buttonStyle(.bordered)
                        .disabled(store.vaults.isEmpty)

                        Button("Add Appointment") {
                            isPresentingAppointmentSheet = true
                        }
                        .buttonStyle(.bordered)
                        .disabled(store.activeImport == nil)

                        Button("Add Medication") {
                            isPresentingMedicationSheet = true
                        }
                        .buttonStyle(.bordered)
                        .disabled(store.activeImport == nil)

                        Button("Add Document") {
                            isPresentingDocumentSheet = true
                        }
                        .buttonStyle(.bordered)
                        .disabled(store.activeImport == nil)
                    }
                }

                InspectorSection(title: "Selected Import") {
                    if let activeImport = store.activeImport {
                        DetailRow(label: "File", value: activeImport.fileName)
                        DetailRow(label: "Type", value: activeImport.importType.replacingOccurrences(of: "_", with: " ").capitalized)
                        DetailRow(label: "Status", value: activeImport.status.capitalized)
                        HStack(spacing: 8) {
                            ForEach(["pending", "processing", "completed", "failed"], id: \.self) { status in
                                Button(status.capitalized) {
                                    Task { await store.updateImportStatus(status) }
                                }
                                .buttonStyle(.bordered)
                                .tint(status == activeImport.status ? .accentColor : .secondary)
                                .disabled(store.isMutating)
                            }
                        }
                    } else {
                        Text("Create or select an import to manage its status.")
                            .foregroundStyle(.secondary)
                    }
                }

                InspectorSection(title: "Appointments") {
                    if store.appointments.isEmpty {
                        Text("No appointments for the selected import.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.appointments.prefix(10)) { appointment in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(appointment.provider)
                                    .font(.headline)
                                Text(appointment.redactedSummary)
                                    .foregroundStyle(.secondary)
                                Text(DateFormatting.formatAbsoluteTime(appointment.date))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                InspectorSection(title: "Medications") {
                    if store.medications.isEmpty {
                        Text("No medications for the selected import.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.medications.prefix(10)) { medication in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(medication.name)
                                    .font(.headline)
                                Text(medication.redactedSummary)
                                    .foregroundStyle(.secondary)
                                Text(medication.frequency ?? medication.dosage ?? "Schedule not recorded")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                InspectorSection(title: "Documents") {
                    if store.documents.isEmpty {
                        Text("No supporting medical documents for the selected import.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.documents.prefix(8)) { document in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(document.fileName)
                                    .font(.headline)
                                Text(document.redactedSummary)
                                    .foregroundStyle(.secondary)
                                Text(ByteCountFormatter.string(fromByteCount: Int64(document.sizeBytes), countStyle: .file))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private var vaultSection: some View {
        InspectorSection(title: "Vault") {
            if store.vaults.isEmpty {
                Text("No vault status is available yet.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(store.vaults) { vault in
                    DetailRow(label: vault.kind.capitalized, value: vault.status.replacingOccurrences(of: "_", with: " ").capitalized)
                    DetailRow(label: "Encrypted", value: vault.encrypted ? "Yes" : "No")
                    if let keyRef = vault.encryptionKeyRef {
                        DetailRow(label: "Key Ref", value: keyRef)
                    }
                }
                HStack(spacing: 8) {
                    Button("Open Vault") {
                        Task { await store.openVault() }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(store.primaryVault == nil || store.isMutating)

                    Button("Close Vault") {
                        Task { await store.closeVault() }
                    }
                    .buttonStyle(.bordered)
                    .disabled(store.primaryVault == nil || store.isMutating)
                }
            }
        }
    }

    private func reload() {
        Task { await store.load() }
    }

    @ViewBuilder
    private var mutationBanner: some View {
        if let message = store.mutationMessage {
            Label(message, systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        } else if let message = store.mutationErrorMessage {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
        }
    }
}
