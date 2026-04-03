import SwiftUI
import PopeyeAPI

struct CommandCenterView: View {
    var store: CommandCenterStore

    var body: some View {
        Group {
            if store.isLoading && store.lastUpdated == nil {
                LoadingStateView(title: "Loading command center...")
            } else {
                commandCenterContent
            }
        }
        .navigationTitle("Command Center")
        .popeyeRefreshable(invalidationSignals: [.runs, .jobs, .interventions, .general]) {
            await store.load()
        }
        .task {
            await store.load()
            store.startPolling()
        }
        .onDisappear {
            store.stopPolling()
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
        .padding(PopeyeUI.contentPadding)
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
            VStack(spacing: PopeyeUI.sectionSpacing) {
                AttentionQueuePanel(store: store)
                ActiveRunsPanel(store: store)
                JobsInMotionPanel(store: store)
            }
            .padding(PopeyeUI.contentPadding)
        }
    }
}
