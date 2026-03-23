import SwiftUI
import PopeyeAPI

struct ConnectView: View {
    @Environment(AppModel.self) private var appModel
    @State private var baseURL = ""
    @State private var token = ""
    @State private var isConnecting = false

    var body: some View {
        VStack(spacing: 32) {
            header
            connectionForm
            errorBanner
        }
        .frame(width: 420)
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            baseURL = appModel.baseURL
        }
    }

    private var header: some View {
        VStack(spacing: 8) {
            Image(systemName: "command.square.fill")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
            Text("Popeye")
                .font(.largeTitle.bold())
            Text("Connect to your local daemon")
                .foregroundStyle(.secondary)
        }
    }

    private var connectionForm: some View {
        Form {
            TextField("Base URL", text: $baseURL)
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .help("Loopback address of the Popeye daemon")

            SecureField("Bearer Token", text: $token)
                .textFieldStyle(.roundedBorder)
                .help("Operator bearer token for authentication")

            Button(action: connect) {
                if isConnecting {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Text("Connect")
                }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(baseURL.isEmpty || token.isEmpty || isConnecting)
            .frame(maxWidth: .infinity)
        }
        .formStyle(.columns)
    }

    @ViewBuilder
    private var errorBanner: some View {
        if case .failed(let error) = appModel.connectionState {
            Label(error.userMessage, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .font(.callout)
        }
    }

    private func connect() {
        guard !isConnecting else { return }
        isConnecting = true
        Task {
            await appModel.connect(baseURL: baseURL, token: token)
            isConnecting = false
        }
    }
}

#Preview {
    ConnectView()
        .environment(AppModel())
}
