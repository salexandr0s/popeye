import SwiftUI
import PopeyeAPI

struct CommandCenterView: View {
    var store: CommandCenterStore
    @State private var debouncer = ReloadDebouncer()

    var body: some View {
        Group {
            if store.isLoading && store.lastUpdated == nil {
                LoadingStateView(title: "Loading command center...")
            } else {
                commandCenterContent
            }
        }
        .navigationTitle("Command Center")
        .task {
            await store.load()
            store.startPolling()
        }
        .onDisappear {
            store.stopPolling()
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeRefresh)) { _ in
            Task { await store.load() }
        }
        .onReceive(NotificationCenter.default.publisher(for: .popeyeInvalidation)) { notification in
            guard let signal = notification.object as? InvalidationSignal else { return }
            if [.runs, .jobs, .interventions, .general].contains(signal) {
                debouncer.schedule { [store] in await store.load() }
            }
        }
    }

    private var commandCenterContent: some View {
        VStack(spacing: 0) {
            summaryHeader
            Divider()
            panelArea
        }
    }

    private var summaryHeader: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Operations Overview")
                    .font(.title2.bold())
                Spacer()
                FreshnessPill(lastUpdated: store.lastUpdated)
            }
            SummaryStrip(store: store)
        }
        .padding(16)
    }

    private var panelArea: some View {
        HSplitView {
            leftPanels
                .frame(minWidth: 300)
            CommandCenterInspector(store: store)
                .frame(minWidth: 260)
        }
    }

    private var leftPanels: some View {
        ScrollView {
            VStack(spacing: 20) {
                AttentionQueuePanel(store: store)
                ActiveRunsPanel(store: store)
                JobsInMotionPanel(store: store)
            }
            .padding(16)
        }
    }
}
