import SwiftUI
import PopeyeAPI

enum OAuthProviderConfigKind: String, CaseIterable, Identifiable, Sendable {
    case google
    case github

    var id: String { rawValue }

    var title: String {
        switch self {
        case .google: "Google"
        case .github: "GitHub"
        }
    }

    var clientIdLabel: String {
        switch self {
        case .google: "Google OAuth Client ID"
        case .github: "GitHub OAuth Client ID"
        }
    }

    var clientSecretLabel: String {
        switch self {
        case .google: "Google OAuth Client Secret"
        case .github: "GitHub OAuth Client Secret"
        }
    }

    var saveButtonTitle: String {
        "Save \(title) OAuth"
    }
}

struct OAuthProviderConfigDraft: Equatable {
    var clientId = ""
    var clientSecret = ""
    var clearStoredSecret = false

    var normalizedClientId: String? {
        let trimmed = clientId.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var normalizedClientSecret: String? {
        let trimmed = clientSecret.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    var hasConflictingSecretInstructions: Bool {
        clearStoredSecret && normalizedClientSecret != nil
    }

    mutating func apply(record: ProviderAuthConfigDTO?) {
        clientId = record?.clientId ?? ""
        clientSecret = ""
        clearStoredSecret = false
    }

    mutating func clearSensitiveFields() {
        clientSecret = ""
        clearStoredSecret = false
    }
}

struct OAuthProviderConfigSheet: View {
    let provider: OAuthProviderConfigKind
    let currentRecord: ProviderAuthConfigDTO?
    @Binding var draft: OAuthProviderConfigDraft
    let isSaving: Bool
    let errorMessage: String?
    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        Form {
            Section("Current Status") {
                LabeledContent("Provider") {
                    Text(provider.title)
                }
                LabeledContent("Readiness") {
                    Text(currentRecord?.status.replacingOccurrences(of: "_", with: " ").capitalized ?? "Unknown")
                }
                LabeledContent("Stored Secret") {
                    Text(currentRecord?.secretAvailability.replacingOccurrences(of: "_", with: " ").capitalized ?? "Unknown")
                }
                if let details = currentRecord?.details, details.isEmpty == false {
                    Text(details)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Section("Credentials") {
                TextField(provider.clientIdLabel, text: $draft.clientId)

                SecureField(provider.clientSecretLabel, text: $draft.clientSecret)

                Text("Leave the secret blank to keep the current stored secret.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)

                Toggle("Clear stored secret", isOn: $draft.clearStoredSecret)

                if draft.hasConflictingSecretInstructions {
                    Text("You cannot clear the stored secret and save a new secret in the same request.")
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
            }

            if let errorMessage, errorMessage.isEmpty == false {
                Section {
                    Text(errorMessage)
                        .foregroundStyle(.red)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .formStyle(.grouped)
        .frame(minWidth: 480, idealWidth: 520, minHeight: 340)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Cancel", action: onCancel)
            }
            ToolbarItem(placement: .confirmationAction) {
                Button(provider.saveButtonTitle, action: onSubmit)
                    .disabled(isSaving || draft.hasConflictingSecretInstructions)
            }
        }
    }
}
