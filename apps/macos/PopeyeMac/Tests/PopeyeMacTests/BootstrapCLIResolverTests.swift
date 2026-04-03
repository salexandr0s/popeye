import Testing
import Foundation
@testable import PopeyeMac

@Suite("Bootstrap CLI Resolver")
struct BootstrapCLIResolverTests {
    @Test("Bundled companion CLI wins over all other sources")
    func bundledCompanionPreferred() throws {
        try withTemporaryDirectory { root in
            let bundled = root
                .appendingPathComponent("Bootstrap", isDirectory: true)
                .appendingPathComponent("pop", isDirectory: false)
            try makeExecutable(at: bundled)

            let envOverride = root.appendingPathComponent("env-pop", isDirectory: false)
            try makeExecutable(at: envOverride)

            let resolver = BootstrapCLIResolver(
                bundleResourceURL: root,
                environment: ["POPEYE_MAC_BOOTSTRAP_CLI": envOverride.path],
                standardLocations: ["/usr/local/bin/pop"],
                isExecutable: { $0 == bundled.path || $0 == envOverride.path || $0 == "/usr/local/bin/pop" },
                whichLookup: { "/opt/homebrew/bin/pop" }
            )

            let resolution = try resolver.resolve()
            #expect(resolution.source == .bundled)
            #expect(resolution.executableURL.path == bundled.path)
        }
    }

    @Test("Environment override is used when no bundled CLI exists")
    func environmentOverrideFallback() throws {
        try withTemporaryDirectory { root in
            let envOverride = root.appendingPathComponent("env-pop", isDirectory: false)
            try makeExecutable(at: envOverride)

            let resolver = BootstrapCLIResolver(
                bundleResourceURL: root,
                environment: ["POPEYE_MAC_BOOTSTRAP_CLI": envOverride.path],
                standardLocations: [],
                isExecutable: { $0 == envOverride.path },
                whichLookup: { nil }
            )

            let resolution = try resolver.resolve()
            #expect(resolution.source == .envOverride)
            #expect(resolution.executableURL.path == envOverride.path)
        }
    }

    @Test("Non-executable bundled companion CLI fails fast")
    func bundledCompanionMustBeExecutable() throws {
        try withTemporaryDirectory { root in
            let bundled = root
                .appendingPathComponent("Bootstrap", isDirectory: true)
                .appendingPathComponent("pop", isDirectory: false)
            try FileManager.default.createDirectory(
                at: bundled.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            try Data("#!/bin/sh\nexit 0\n".utf8).write(to: bundled)
            try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: bundled.path)

            let resolver = BootstrapCLIResolver(
                bundleResourceURL: root,
                environment: ["POPEYE_MAC_BOOTSTRAP_CLI": "/usr/local/bin/pop"],
                standardLocations: ["/usr/local/bin/pop"],
                isExecutable: { $0 == "/usr/local/bin/pop" },
                whichLookup: { nil }
            )

            do {
                _ = try resolver.resolve()
                Issue.record("Expected non-executable bundled CLI to throw")
            } catch let error as BootstrapCLIResolutionError {
                #expect(error == .bundledCLIIsNotExecutable(bundled.path))
            } catch {
                Issue.record("Unexpected error: \(error)")
            }
        }
    }

    @Test("Standard install locations beat which fallback")
    func standardLocationsPreferredOverWhich() throws {
        let standardPath = "/opt/homebrew/bin/pop"
        let resolver = BootstrapCLIResolver(
            bundleResourceURL: nil,
            environment: [:],
            standardLocations: ["/usr/local/bin/pop", standardPath],
            isExecutable: { $0 == standardPath || $0 == "/custom/bin/pop" },
            whichLookup: { "/custom/bin/pop" }
        )

        let resolution = try resolver.resolve()
        #expect(resolution.source == .standardLocation)
        #expect(resolution.executableURL.path == standardPath)
    }

    @Test("Which lookup is used as the final fallback")
    func whichFallback() throws {
        let whichPath = "/custom/bin/pop"
        let resolver = BootstrapCLIResolver(
            bundleResourceURL: nil,
            environment: [:],
            standardLocations: [],
            isExecutable: { $0 == whichPath },
            whichLookup: { whichPath }
        )

        let resolution = try resolver.resolve()
        #expect(resolution.source == .whichLookup)
        #expect(resolution.executableURL.path == whichPath)
    }

    @Test("Invalid environment override fails with a targeted error")
    func invalidEnvironmentOverride() {
        let resolver = BootstrapCLIResolver(
            bundleResourceURL: nil,
            environment: ["POPEYE_MAC_BOOTSTRAP_CLI": "/missing/pop"],
            standardLocations: [],
            isExecutable: { _ in false },
            whichLookup: { nil }
        )

        do {
            _ = try resolver.resolve()
            Issue.record("Expected invalid environment override to throw")
        } catch let error as BootstrapCLIResolutionError {
            #expect(error == .invalidEnvironmentOverride("/missing/pop"))
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    @Test("Missing CLI reports the searched locations")
    func missingCLI() {
        let resolver = BootstrapCLIResolver(
            bundleResourceURL: nil,
            environment: [:],
            standardLocations: ["/usr/local/bin/pop", "/opt/homebrew/bin/pop"],
            isExecutable: { _ in false },
            whichLookup: { nil }
        )

        do {
            _ = try resolver.resolve()
            Issue.record("Expected missing CLI resolution to throw")
        } catch let error as BootstrapCLIResolutionError {
            guard case .cliNotFound(let searchedLocations) = error else {
                Issue.record("Unexpected resolution error: \(error)")
                return
            }
            #expect(searchedLocations == [
                "/usr/local/bin/pop",
                "/opt/homebrew/bin/pop",
                "`which pop`"
            ])
        } catch {
            Issue.record("Unexpected error: \(error)")
        }
    }

    private func withTemporaryDirectory(_ body: (URL) throws -> Void) throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        try body(root)
    }

    private func makeExecutable(at url: URL) throws {
        try FileManager.default.createDirectory(
            at: url.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try Data("#!/bin/sh\nexit 0\n".utf8).write(to: url)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: url.path)
    }
}
