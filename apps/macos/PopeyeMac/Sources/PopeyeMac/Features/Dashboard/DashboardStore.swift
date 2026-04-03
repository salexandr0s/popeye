import Foundation
import PopeyeAPI

@Observable
@MainActor
final class DashboardStore {
    enum LoadingState {
        case idle
        case loading
        case loaded
        case failed(APIError)
    }

    struct Dependencies: Sendable {
        var loadSnapshot: @Sendable () async throws -> DashboardSnapshot

        static func live(service: SystemService) -> Dependencies {
            Dependencies(loadSnapshot: {
                try await service.loadDashboardSnapshot()
            })
        }
    }

    var snapshot: DashboardSnapshot?
    var loadingState: LoadingState = .idle
    var lastUpdated: Date?

    private let dependencies: Dependencies
    private var pollTask: Task<Void, Never>?

    private static let staleThresholdSeconds: TimeInterval = 20
    private let pollIntervalSeconds: UInt64

    init(service: SystemService, pollIntervalSeconds: Int = 15) {
        self.dependencies = .live(service: service)
        self.pollIntervalSeconds = UInt64(pollIntervalSeconds)
    }

    init(dependencies: Dependencies, pollIntervalSeconds: Int = 15) {
        self.dependencies = dependencies
        self.pollIntervalSeconds = UInt64(pollIntervalSeconds)
    }

    var isStale: Bool {
        guard let lastUpdated else { return true }
        return Date.now.timeIntervalSince(lastUpdated) > Self.staleThresholdSeconds
    }

    func load() async {
        loadingState = .loading
        do {
            snapshot = try await dependencies.loadSnapshot()
            lastUpdated = .now
            loadingState = .loaded
        } catch let error as APIError {
            loadingState = .failed(error)
        } catch {
            loadingState = .failed(.transportUnavailable)
        }
    }

    func refresh() async {
        do {
            let newSnapshot = try await dependencies.loadSnapshot()
            snapshot = newSnapshot
            lastUpdated = .now
            if case .failed = loadingState {
                loadingState = .loaded
            }
        } catch {
            PopeyeLogger.refresh.error("Dashboard refresh failed: \(error)")
        }
    }

    func startPolling() {
        stopPolling()
        let interval = pollIntervalSeconds
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(interval))
                guard !Task.isCancelled else { break }
                await self?.refresh()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }
}
