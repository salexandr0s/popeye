import Foundation

struct BootstrapCLIResolver: Sendable {
    let bundleResourceURL: URL?
    let environment: [String: String]
    let standardLocations: [String]
    let isExecutable: @Sendable (String) -> Bool
    let whichLookup: @Sendable () -> String?

    init(
        bundleResourceURL: URL? = Bundle.main.resourceURL,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        standardLocations: [String] = ["/usr/local/bin/pop", "/opt/homebrew/bin/pop"],
        isExecutable: @escaping @Sendable (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
        whichLookup: @escaping @Sendable () -> String? = Self.defaultWhichLookup
    ) {
        self.bundleResourceURL = bundleResourceURL
        self.environment = environment
        self.standardLocations = standardLocations
        self.isExecutable = isExecutable
        self.whichLookup = whichLookup
    }

    func resolve() throws -> BootstrapCLIResolution {
        var searchedLocations: [String] = []

        if let bundleResourceURL {
            let bundledURL = bundleResourceURL
                .appendingPathComponent("Bootstrap", isDirectory: true)
                .appendingPathComponent("pop", isDirectory: false)
            searchedLocations.append("bundled companion CLI at \(bundledURL.path)")
            let bundledPath = bundledURL.path
            if FileManager.default.fileExists(atPath: bundledPath) {
                guard isExecutable(bundledPath) else {
                    throw BootstrapCLIResolutionError.bundledCLIIsNotExecutable(bundledPath)
                }
                return BootstrapCLIResolution(executableURL: bundledURL, source: .bundled)
            }
        }

        if let overridePath = environment["POPEYE_MAC_BOOTSTRAP_CLI"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           overridePath.isEmpty == false {
            searchedLocations.append("POPEYE_MAC_BOOTSTRAP_CLI=\(overridePath)")
            guard isExecutable(overridePath) else {
                throw BootstrapCLIResolutionError.invalidEnvironmentOverride(overridePath)
            }
            return BootstrapCLIResolution(executableURL: URL(fileURLWithPath: overridePath), source: .envOverride)
        }

        for standardLocation in standardLocations {
            searchedLocations.append(standardLocation)
            if isExecutable(standardLocation) {
                return BootstrapCLIResolution(
                    executableURL: URL(fileURLWithPath: standardLocation),
                    source: .standardLocation
                )
            }
        }

        searchedLocations.append("`which pop`")
        if let whichPath = whichLookup()?.trimmingCharacters(in: .whitespacesAndNewlines),
           whichPath.isEmpty == false,
           isExecutable(whichPath) {
            return BootstrapCLIResolution(
                executableURL: URL(fileURLWithPath: whichPath),
                source: .whichLookup
            )
        }

        throw BootstrapCLIResolutionError.cliNotFound(searchedLocations: searchedLocations)
    }

    private static func defaultWhichLookup() -> String? {
        let process = Process()
        let stdout = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/which")
        process.arguments = ["pop"]
        process.standardOutput = stdout
        process.standardError = Pipe()

        do {
            try process.run()
        } catch {
            return nil
        }

        process.waitUntilExit()
        guard process.terminationStatus == 0 else {
            return nil
        }

        let output = stdout.fileHandleForReading.readDataToEndOfFile()
        guard let path = String(data: output, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines),
              path.isEmpty == false else {
            return nil
        }
        return path
    }
}
