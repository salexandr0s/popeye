import Foundation
import PopeyeAPI

@Observable @MainActor
final class DashboardStore {
    enum LoadingState {
        case idle
        case loading
        case loaded
        case failed(APIError)
    }

    var snapshot: DashboardSnapshot?
    var loadingState: LoadingState = .idle
    var lastUpdated: Date?

    private let service: SystemService
    private var pollTask: Task<Void, Never>?

    private static let staleThresholdSeconds: TimeInterval = 20
    private let pollIntervalSeconds: UInt64

    init(service: SystemService, pollIntervalSeconds: Int = 15) {
        self.service = service
        self.pollIntervalSeconds = UInt64(pollIntervalSeconds)
    }

    var isStale: Bool {
        guard let lastUpdated else { return true }
        return Date.now.timeIntervalSince(lastUpdated) > Self.staleThresholdSeconds
    }

    func load() async {
        loadingState = .loading
        do {
            snapshot = try await service.loadDashboardSnapshot()
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
            let newSnapshot = try await service.loadDashboardSnapshot()
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
