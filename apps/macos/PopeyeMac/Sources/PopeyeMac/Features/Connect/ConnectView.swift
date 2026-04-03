import SwiftUI
import PopeyeAPI

struct ConnectView: View {
    @Environment(AppModel.self) private var appModel
    @State private var baseURL = ""
    @State private var token = ""
    @State private var isManualConnecting = false
    @State private var showAdvanced = false

    var body: some View {
        VStack(spacing: 24) {
            header
            localAccessPanel
            advancedPanel
            errorBanner
        }
        .frame(minWidth: 440, idealWidth: 500, maxWidth: 560)
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .task(id: appModel.baseURL) {
            baseURL = appModel.baseURL
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            if let logo = PopeyeBranding.logoImage {
                ZStack {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(.background.secondary)

                    Image(nsImage: logo)
                        .resizable()
                        .scaledToFit()
                        .padding(14)
                }
                .frame(width: 92, height: 92)
                .overlay {
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .strokeBorder(.quaternary)
                }
                .shadow(color: .black.opacity(0.12), radius: 10, y: 4)
                .accessibilityHidden(true)
            } else {
                Image(systemName: "command.square.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(.tint)
            }

            Text("Popeye")
                .font(.largeTitle.bold())
            Text("Set up local access or connect manually.")
                .foregroundStyle(.secondary)
        }
    }

    private var localAccessPanel: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 16) {
                switch appModel.bootstrapStep {
                case .checking:
                    ProgressView("Checking local Popeye setup…")
                        .controlSize(.regular)
                case .createLocalSetup:
                    Text("Create the local Popeye config and auth store for this Mac.")
                        .foregroundStyle(.secondary)
                    primaryActionButton(title: "Create Local Setup") {
                        await appModel.createLocalSetup()
                    }
                case .startDaemon:
                    Text("Local setup exists, but the Popeye daemon is not running.")
                        .foregroundStyle(.secondary)
                    primaryActionButton(title: "Start Popeye") {
                        await appModel.startLocalDaemon()
                    }
                case .grantLocalAccess:
                    Text("Popeye is running locally. Grant this Mac app local access.")
                        .foregroundStyle(.secondary)
                    primaryActionButton(title: "Grant Local Access") {
                        await appModel.grantLocalAccess()
                    }
                case .manualFallback:
                    Text("Local bootstrap is unavailable right now. You can retry, or connect manually below.")
                        .foregroundStyle(.secondary)
                    HStack {
                        Button("Retry Local Check") {
                            Task {
                                await appModel.refreshBootstrapStatus()
                            }
                        }
                        .buttonStyle(.bordered)

                        Spacer(minLength: 0)
                    }
                }

                if let status = appModel.bootstrapStatus {
                    statusSummary(status)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        } label: {
            Label("Local Access", systemImage: "macwindow.and.cursorarrow")
        }
    }

    @ViewBuilder
    private var advancedPanel: some View {
        DisclosureGroup(isExpanded: $showAdvanced) {
            VStack(spacing: 16) {
                TextField("Base URL", text: $baseURL)
                    .textFieldStyle(.roundedBorder)
                    .autocorrectionDisabled()
                    .help("Loopback or remote Popeye daemon base URL")

                SecureField("Bearer Token", text: $token)
                    .textFieldStyle(.roundedBorder)
                    .help("Operator bearer token for manual or remote access")

                HStack {
                    Spacer()

                    Button(action: manualConnect) {
                        if isManualConnecting {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Text("Connect Manually")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(baseURL.isEmpty || token.isEmpty || isManualConnecting || appModel.isBootstrapBusy)
                }
            }
            .padding(.top, 12)
        } label: {
            Text("Advanced")
                .font(.headline)
        }
        .padding(.top, 4)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if let message = appModel.connectErrorMessage {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .font(.callout)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private func statusSummary(_ status: LocalBootstrapStatus) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Divider()
            LabeledContent("Config") {
                Text(status.configExists ? (status.configValid ? "Ready" : "Needs attention") : "Missing")
            }
            LabeledContent("Daemon") {
                Text(status.daemonReachable ? "Running" : "Not running")
            }
        }
        .font(.callout)
        .foregroundStyle(.secondary)
    }

    private func primaryActionButton(title: String, action: @escaping @Sendable () async -> Void) -> some View {
        Button {
            Task {
                await action()
            }
        } label: {
            if appModel.isBootstrapBusy {
                ProgressView()
                    .controlSize(.small)
            } else {
                Text(title)
            }
        }
        .buttonStyle(.borderedProminent)
        .keyboardShortcut(.defaultAction)
        .disabled(appModel.isBootstrapBusy || isManualConnecting)
    }

    private func manualConnect() {
        guard isManualConnecting == false else { return }
        isManualConnecting = true
        Task {
            await appModel.connect(baseURL: baseURL, token: token)
            isManualConnecting = false
        }
    }
}

#Preview {
    ConnectView()
        .environment(AppModel())
}
