import Foundation

struct LocalBootstrapService {
    private let decoder: JSONDecoder
    private let resolver: BootstrapCLIResolver

    init(
        decoder: JSONDecoder = JSONDecoder(),
        resolver: BootstrapCLIResolver = BootstrapCLIResolver()
    ) {
        self.decoder = decoder
        self.resolver = resolver
    }

    func status() async throws -> LocalBootstrapStatus {
        try await runJSONCommand(arguments: ["bootstrap", "status"], as: LocalBootstrapStatus.self)
    }

    func ensureLocalSetup() async throws -> LocalBootstrapStatus {
        try await runJSONCommand(arguments: ["bootstrap", "ensure-local"], as: LocalBootstrapStatus.self)
    }

    func startDaemon() async throws -> LocalBootstrapStatus {
        try await runJSONCommand(arguments: ["bootstrap", "start-daemon"], as: LocalBootstrapStatus.self)
    }

    func issueNativeSession(clientName: String = "PopeyeMac") async throws -> LocalBootstrapSession {
        try await runJSONCommand(arguments: ["bootstrap", "issue-native-session", "--client-name", clientName], as: LocalBootstrapSession.self)
    }

    private func runJSONCommand<T: Decodable & Sendable>(arguments: [String], as type: T.Type) async throws -> T {
        let data = try await runCommand(arguments: arguments + ["--json"])
        return try decoder.decode(T.self, from: data)
    }

    private func runCommand(arguments: [String]) async throws -> Data {
        let resolver = self.resolver

        return try await Task.detached(priority: .userInitiated) {
            let resolution: BootstrapCLIResolution
            do {
                resolution = try resolver.resolve()
            } catch let error as BootstrapCLIResolutionError {
                throw LocalBootstrapError.commandUnavailable(error.localizedDescription)
            }

            let process = Process()
            let stdout = Pipe()
            let stderr = Pipe()

            process.executableURL = resolution.executableURL
            process.arguments = arguments
            process.standardOutput = stdout
            process.standardError = stderr
            process.environment = ProcessInfo.processInfo.environment

            do {
                try process.run()
            } catch {
                throw LocalBootstrapError.commandUnavailable(
                    "Resolved Popeye CLI from \(resolution.source.displayName) at \(resolution.executableURL.path) could not be launched."
                )
            }

            let stdoutTask = Task.detached(priority: .userInitiated) {
                stdout.fileHandleForReading.readDataToEndOfFile()
            }
            let stderrTask = Task.detached(priority: .userInitiated) {
                stderr.fileHandleForReading.readDataToEndOfFile()
            }

            process.waitUntilExit()

            let output = await stdoutTask.value
            let errorOutput = await stderrTask.value

            guard process.terminationStatus == 0 else {
                let message = String(data: errorOutput, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
                if let message, message.isEmpty == false {
                    throw LocalBootstrapError.commandFailed(message)
                }
                throw LocalBootstrapError.commandFailed("Bootstrap command failed")
            }

            return output
        }.value
    }
}

enum LocalBootstrapError: LocalizedError, Sendable, Equatable {
    case commandUnavailable(String)
    case commandFailed(String)

    var errorDescription: String? {
        switch self {
        case .commandUnavailable(let message):
            return message
        case .commandFailed(let message):
            return message
        }
    }
}
