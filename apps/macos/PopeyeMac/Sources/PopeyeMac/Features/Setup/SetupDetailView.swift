import SwiftUI

struct SetupDetailView: View {
    let card: SetupCard
    let statusMessage: String?
    let errorMessage: String?
    let isPerformingPrimaryAction: Bool
    let runPrimaryAction: (SetupCardAction) -> Void
    let openDestination: (SetupCardDestination) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Label(card.id.title, systemImage: card.id.systemImage)
                        .font(.title2.bold())

                    StatusBadge(state: card.state.rawValue)

                    Text(card.summary)
                        .font(.title3)

                    Text(card.guidance)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }

                if let statusMessage, statusMessage.isEmpty == false {
                    HStack(spacing: 10) {
                        ProgressView()
                            .controlSize(.small)

                        Text(statusMessage)
                            .foregroundStyle(.secondary)
                    }
                }

                if let errorMessage, errorMessage.isEmpty == false {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .foregroundStyle(.orange)
                }

                InspectorSection(title: "Details") {
                    ForEach(card.detailRows) { row in
                        DetailRow(label: row.label, value: row.value)
                    }
                }

                if card.followUpRows.isEmpty == false {
                    InspectorSection(title: "Remaining Setup") {
                        ForEach(card.followUpRows) { row in
                            DetailRow(label: row.label, value: row.value)
                        }
                    }
                }

                if let followUpFootnote = card.followUpFootnote {
                    Text(followUpFootnote)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }

                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 12) {
                        if let primaryAction = card.primaryAction {
                            Button(primaryAction.title) {
                                runPrimaryAction(primaryAction)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(isPerformingPrimaryAction)
                        }

                        if let destination = card.destination {
                            if card.primaryAction == nil {
                                Button(actionTitle(for: destination)) {
                                    openDestination(destination)
                                }
                                .buttonStyle(.borderedProminent)
                                .disabled(isPerformingPrimaryAction)
                            } else {
                                Button(actionTitle(for: destination)) {
                                    openDestination(destination)
                                }
                                .buttonStyle(.bordered)
                                .disabled(isPerformingPrimaryAction)
                            }
                        }
                    }

                    if card.supplementaryActions.isEmpty == false {
                        HStack(spacing: 12) {
                            ForEach(card.supplementaryActions, id: \.title) { action in
                                Button(action.title) {
                                    runPrimaryAction(action)
                                }
                                .buttonStyle(.bordered)
                                .disabled(isPerformingPrimaryAction)
                            }
                        }
                    }
                }
            }
            .padding(20)
        }
    }

    private func actionTitle(for destination: SetupCardDestination) -> String {
        switch destination {
        case .connections:
            "Open Connections"
        case .telegram:
            "Open Telegram"
        }
    }
}
