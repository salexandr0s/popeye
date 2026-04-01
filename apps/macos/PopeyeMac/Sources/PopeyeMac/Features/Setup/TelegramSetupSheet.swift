import SwiftUI

struct TelegramSetupSheet: View {
    @Binding var draft: TelegramSetupDraft
    let isSaving: Bool
    let errorMessage: String?
    let onCancel: () -> Void
    let onSubmit: () -> Void

    private var submitTitle: String {
        draft.normalizedBotToken.isEmpty ? "Save Config" : "Store Token & Save Config"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Configure Telegram")
                    .font(.title3.bold())

                Text("Store a Telegram bot token if needed, choose whether the bridge is enabled, and set the allowed user ID. Apply or restart from the detail pane after saving.")
                    .foregroundStyle(.secondary)
            }

            Form {
                Toggle("Enable Telegram bridge", isOn: $draft.enabled)

                TextField("Allowed Telegram User ID", text: $draft.allowedUserId)
                    .textFieldStyle(.roundedBorder)

                LabeledContent("Current Secret Ref") {
                    Text(draft.currentSecretRefId ?? "Not set")
                        .foregroundStyle(draft.currentSecretRefId == nil ? .secondary : .primary)
                        .textSelection(.enabled)
                }

                SecureField("New Bot Token (optional)", text: $draft.botToken)
                    .textFieldStyle(.roundedBorder)

                Text("Leave the token blank to keep the current stored secret reference.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .formStyle(.grouped)

            if let errorMessage, errorMessage.isEmpty == false {
                Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                    .foregroundStyle(.orange)
                    .font(.callout)
            }

            HStack {
                Button("Cancel", role: .cancel, action: onCancel)
                    .keyboardShortcut(.escape)

                Spacer()

                Button(isSaving ? "Saving…" : submitTitle, action: onSubmit)
                    .keyboardShortcut(.return)
                    .buttonStyle(.borderedProminent)
                    .disabled(isSaving || draft.canSubmit == false)
            }
        }
        .padding(20)
        .frame(width: 480)
    }
}
