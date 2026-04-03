import Testing
import Foundation
@testable import PopeyeMac

@Suite("Local Bootstrap Service")
struct LocalBootstrapServiceTests {
    @Test("Successful bootstrap command returns decoded JSON")
    func decodesJSONStatus() async throws {
        try await withTemporaryCommand { commandURL in
            let service = makeService(commandURL: commandURL)

            let status = try await service.status()
            #expect(status.configPath == "/tmp/popeye/config.json")
            #expect(status.baseURL == "http://127.0.0.1:3210")
            #expect(status.configExists == true)
            #expect(status.canGrantNativeSession == true)
            #expect(status.error == nil)
        } script: {
            """
            #!/bin/sh
            cat <<'JSON'
            {"configPath":"/tmp/popeye/config.json","baseURL":"http://127.0.0.1:3210","configExists":true,"configValid":true,"daemonInstalled":true,"daemonLoaded":true,"daemonReachable":true,"authStoreReady":true,"nativeAppSessionsSupported":true,"needsLocalSetup":false,"needsDaemonStart":false,"canGrantNativeSession":true,"error":null}
            JSON
            """
        }
    }

    @Test("Failed bootstrap command surfaces stderr text")
    func surfacesStderrOnFailure() async throws {
        try await withTemporaryCommand { commandURL in
            let service = makeService(commandURL: commandURL)

            do {
                _ = try await service.status()
                Issue.record("Expected bootstrap command failure")
            } catch let error as LocalBootstrapError {
                #expect(error == .commandFailed("bootstrap exploded"))
            } catch {
                Issue.record("Unexpected error: \(error)")
            }
        } script: {
            """
            #!/bin/sh
            printf 'bootstrap exploded\\n' >&2
            exit 7
            """
        }
    }

    @Test("Large stdout and stderr output does not hang the bootstrap reader")
    func drainsLargeOutputWithoutHanging() async throws {
        try await withTemporaryCommand { commandURL in
            let service = makeService(commandURL: commandURL)

            let status = try await service.status()
            #expect(status.baseURL == "http://127.0.0.1:3210")
            #expect(status.daemonReachable == true)
        } script: {
            """
            #!/bin/sh
            python3 - <<'PY'
            import json
            import sys

            payload = {
                "configPath": "/tmp/popeye/config.json",
                "baseURL": "http://127.0.0.1:3210",
                "configExists": True,
                "configValid": True,
                "daemonInstalled": True,
                "daemonLoaded": True,
                "daemonReachable": True,
                "authStoreReady": True,
                "nativeAppSessionsSupported": True,
                "needsLocalSetup": False,
                "needsDaemonStart": False,
                "canGrantNativeSession": True,
                "error": None,
                "padding": "x" * (256 * 1024),
            }

            sys.stderr.write("e" * (256 * 1024))
            sys.stdout.write(json.dumps(payload))
            PY
            """
        }
    }

    private func makeService(commandURL: URL) -> LocalBootstrapService {
        LocalBootstrapService(
            resolver: BootstrapCLIResolver(
                bundleResourceURL: nil,
                environment: [:],
                standardLocations: [commandURL.path],
                isExecutable: { $0 == commandURL.path },
                whichLookup: { nil }
            )
        )
    }

    private func withTemporaryCommand(
        _ body: (URL) async throws -> Void,
        script: () -> String
    ) async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let commandURL = root.appendingPathComponent("pop", isDirectory: false)
        try script().write(to: commandURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: commandURL.path)

        try await body(commandURL)
    }
}
