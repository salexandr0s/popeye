import SwiftUI
import PopeyeAPI

struct FinanceView: View {
    @Bindable var store: FinanceStore
    @State private var debouncer = ReloadDebouncer()
    @State private var isPresentingImportSheet = false
    @State private var isPresentingTransactionSheet = false

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)

    var body: some View {
        Group {
            if store.isLoading && store.imports.isEmpty && store.vaults.isEmpty {
                LoadingStateView(title: "Loading finance…")
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
        .navigationTitle("Finance")
        .toolbar {
            ToolbarItemGroup {
                Button("New Import", systemImage: "square.and.arrow.down") {
                    isPresentingImportSheet = true
                }
                .disabled(store.vaults.isEmpty)

                Button("Add Transaction", systemImage: "plus.circle") {
                    isPresentingTransactionSheet = true
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
            FinanceImportSheet(vaults: store.vaults) { vaultId, importType, fileName in
                Task { await store.createImport(vaultId: vaultId, importType: importType, fileName: fileName) }
            }
        }
        .sheet(isPresented: $isPresentingTransactionSheet) {
            if let activeImport = store.activeImport {
                FinanceTransactionSheet(importId: activeImport.id) { input in
                    Task { await store.createTransaction(input: input) }
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
                EmptyStateView(icon: "creditcard", title: "No finance imports", description: "Finance records will appear here once vault data is imported through the runtime.")
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
                        DashboardCard(label: "Income", value: digest.totalIncome.formatted(.currency(code: "USD")), description: digest.period, valueColor: .green)
                        DashboardCard(label: "Expenses", value: digest.totalExpenses.formatted(.currency(code: "USD")), description: digest.period, valueColor: .red)
                        DashboardCard(label: "Anomalies", value: "\(digest.anomalyFlags.count)", description: digest.anomalyFlags.isEmpty ? "No anomaly flags" : "Review flagged transactions", valueColor: digest.anomalyFlags.isEmpty ? .green : .orange)
                    }
                }

                InspectorSection(title: "Search") {
                    HStack(spacing: 8) {
                        TextField("Search finance", text: $store.searchText)
                            .textFieldStyle(.roundedBorder)
                            .onSubmit { Task { await store.search() } }
                        Button("Search") { Task { await store.search() } }
                            .buttonStyle(.borderedProminent)
                    }
                    if store.searchResults.isEmpty == false {
                        ForEach(store.searchResults) { result in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(result.description)
                                    .font(.headline)
                                Text(result.redactedSummary)
                                    .foregroundStyle(.secondary)
                                Text(result.amount.formatted(.currency(code: "USD")))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                if let digest = store.digest, digest.anomalyFlags.isEmpty == false {
                    InspectorSection(title: "Anomaly Flags") {
                        ForEach(digest.anomalyFlags) { flag in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(flag.description)
                                        .font(.headline)
                                    Spacer()
                                    StatusBadge(state: flag.severity)
                                }
                                if let transactionId = flag.transactionId {
                                    Text(transactionId)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.secondary)
                                }
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

                        Button("Add Transaction") {
                            isPresentingTransactionSheet = true
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
                        DetailRow(label: "Records", value: "\(activeImport.recordCount)")
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

                InspectorSection(title: "Transactions") {
                    if store.transactions.isEmpty {
                        Text("No transactions for the selected import.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(store.transactions.prefix(12)) { transaction in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(transaction.description)
                                        .font(.headline)
                                    Spacer()
                                    Text(transaction.amount.formatted(.currency(code: transaction.currency)))
                                        .foregroundStyle(transaction.amount >= 0 ? .green : .red)
                                }
                                Text(transaction.redactedSummary)
                                    .foregroundStyle(.secondary)
                                Text(transaction.date)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }

                InspectorSection(title: "Documents") {
                    if store.documents.isEmpty {
                        Text("No supporting documents for the selected import.")
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
