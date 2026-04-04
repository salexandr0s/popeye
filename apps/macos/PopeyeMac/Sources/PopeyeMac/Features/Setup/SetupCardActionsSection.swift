import SwiftUI

struct SetupCardActionsSection: View {
    let card: SetupCard
    let isPerformingPrimaryAction: Bool
    let runPrimaryAction: (SetupCardAction) -> Void
    let openDestination: (SetupCardDestination) -> Void

    var body: some View {
        if card.primaryAction != nil || card.destination != nil || card.supplementaryActions.isEmpty == false {
            InspectorSection(title: "Actions") {
                VStack(alignment: .leading, spacing: 12) {
                    primaryActions

                    if card.supplementaryActions.isEmpty == false {
                        supplementaryActions
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var primaryActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                primaryActionButtons
            }

            VStack(alignment: .leading, spacing: 10) {
                primaryActionButtons
            }
        }
    }

    @ViewBuilder
    private var supplementaryActions: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                supplementaryActionButtons
            }

            VStack(alignment: .leading, spacing: 10) {
                supplementaryActionButtons
            }
        }
    }

    @ViewBuilder
    private var primaryActionButtons: some View {
        if let primaryAction = card.primaryAction {
            Button(primaryAction.title) {
                runPrimaryAction(primaryAction)
            }
            .buttonStyle(.borderedProminent)
            .keyboardShortcut(.defaultAction)
            .help(helpText(for: primaryAction))
            .disabled(isPerformingPrimaryAction)
        }

        if let destination = card.destination {
            if card.primaryAction == nil {
                Button(actionTitle(for: destination)) {
                    openDestination(destination)
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .help(helpText(for: destination))
                .disabled(isPerformingPrimaryAction)
            } else {
                Button(actionTitle(for: destination)) {
                    openDestination(destination)
                }
                .buttonStyle(.bordered)
                .help(helpText(for: destination))
                .disabled(isPerformingPrimaryAction)
            }
        }
    }

    @ViewBuilder
    private var supplementaryActionButtons: some View {
        ForEach(Array(card.supplementaryActions.enumerated()), id: \.offset) { _, action in
            Button(action.title) {
                runPrimaryAction(action)
            }
            .buttonStyle(.bordered)
            .help(helpText(for: action))
            .disabled(isPerformingPrimaryAction)
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

    private func helpText(for action: SetupCardAction) -> String {
        switch action {
        case .oauth(_, let providerKind, _):
            "Open the browser and continue \(providerKind.replacingOccurrences(of: "_", with: " ").capitalized) authorization."
        case .configureOAuth(let provider):
            "Edit the stored \(provider.title) OAuth client ID and client secret."
        case .telegramConfigure:
            "Edit Telegram bridge settings."
        case .telegramApply:
            "Apply the saved Telegram bridge configuration now."
        case .daemonRestart:
            "Request a daemon restart to reload the latest configuration."
        }
    }

    private func helpText(for destination: SetupCardDestination) -> String {
        switch destination {
        case .connections:
            "Open Connections to review provider health and configuration."
        case .telegram:
            "Open the Telegram feature for bridge status and delivery details."
        }
    }
}
