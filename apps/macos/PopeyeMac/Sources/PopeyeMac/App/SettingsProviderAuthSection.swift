import SwiftUI
import PopeyeAPI

struct SettingsProviderAuthSection: View {
    let records: [ProviderAuthConfigDTO]
    let configureProvider: (OAuthProviderConfigKind) -> Void

    var body: some View {
        Section("Provider OAuth") {
            ForEach(providerKinds, id: \.self) { provider in
                let record = records.first { $0.provider == provider.rawValue }
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(provider.title)
                            Text(record?.details ?? "OAuth settings have not been loaded yet.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(record?.status.replacingOccurrences(of: "_", with: " ").capitalized ?? "Unknown")
                            .font(.caption)
                            .foregroundStyle(record?.isReady == true ? .green : .secondary)
                    }

                    Button("Configure OAuth…") {
                        configureProvider(provider)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var providerKinds: [OAuthProviderConfigKind] {
        [.google, .github]
    }
}
