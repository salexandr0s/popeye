import SwiftUI
import PopeyeAPI

struct MemoryInspectorHistorySection: View {
    let history: MemoryHistoryDTO?
    let phase: ScreenOperationPhase
    @Binding var showHistory: Bool
    let loadHistory: () -> Void

    var body: some View {
        InspectorSection(title: "History") {
            DisclosureGroup(isExpanded: $showHistory) {
                VStack(alignment: .leading, spacing: 8) {
                    if phase != .idle {
                        OperationStatusView(
                            phase: phase,
                            loadingTitle: "Loading history…",
                            failureTitle: "History unavailable",
                            retryAction: loadHistory
                        )
                    }

                    if let history {
                        historyContent(history)
                    } else if phase != .loading {
                        Button("Load History", action: loadHistory)
                            .buttonStyle(.bordered)
                            .help("Load versions, evidence, and operator actions for this memory")
                    }
                }
                .padding(.top, 8)
            } label: {
                Text("Show history")
            }
            .accessibilityHint("Shows versions, evidence, and operator actions")
        }
    }

    @ViewBuilder
    private func historyContent(_ history: MemoryHistoryDTO) -> some View {
        if history.versionChain.isEmpty && history.evidenceLinks.isEmpty && history.operatorActions.isEmpty {
            Text("No history recorded.")
                .foregroundStyle(.secondary)
        } else {
            VStack(alignment: .leading, spacing: PopeyeUI.cardSpacing) {
                if !history.versionChain.isEmpty {
                    VStack(alignment: .leading, spacing: PopeyeUI.cardSpacing) {
                        Text("Versions (\(history.versionChain.count))")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                        ForEach(history.versionChain) { version in
                            versionCard(version)
                        }
                    }
                }

                if !history.evidenceLinks.isEmpty {
                    VStack(alignment: .leading, spacing: PopeyeUI.cardSpacing) {
                        Text("Evidence Links (\(history.evidenceLinks.count))")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                        ForEach(history.evidenceLinks) { link in
                            evidenceCard(link)
                        }
                    }
                }

                if !history.operatorActions.isEmpty {
                    VStack(alignment: .leading, spacing: PopeyeUI.cardSpacing) {
                        Text("Operator Actions (\(history.operatorActions.count))")
                            .font(.caption.bold())
                            .foregroundStyle(.secondary)
                        ForEach(history.operatorActions) { action in
                            operatorActionCard(action)
                        }
                    }
                }
            }
        }
    }

    private func versionCard(_ version: MemoryVersionDTO) -> some View {
        MemoryInspectorCard {
            HStack(alignment: .top) {
                Text(version.isLatest ? "Current" : "Superseded")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(version.isLatest ? .primary : .secondary)
                Spacer()
                Text(DateFormatting.formatRelativeTime(version.createdAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            if let relation = version.relation, !relation.isEmpty {
                Text(formatted(relation))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(version.text)
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func evidenceCard(_ link: MemoryEvidenceLinkDTO) -> some View {
        MemoryInspectorCard {
            CopyableRow(label: "Artifact", value: link.artifactId)

            if let excerpt = link.excerpt, !excerpt.isEmpty {
                Text(excerpt)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text(DateFormatting.formatRelativeTime(link.createdAt))
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    private func operatorActionCard(_ action: MemoryOperatorActionDTO) -> some View {
        MemoryInspectorCard {
            HStack(alignment: .top) {
                Text(formatted(action.actionKind))
                    .font(.callout.weight(.semibold))
                Spacer()
                Text(DateFormatting.formatRelativeTime(action.createdAt))
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }

            if !action.reason.isEmpty {
                Text(action.reason)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func formatted(_ value: String) -> String {
        value.replacing("_", with: " ").capitalized
    }
}
