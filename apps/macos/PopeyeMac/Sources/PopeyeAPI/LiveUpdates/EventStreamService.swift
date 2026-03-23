import Foundation

public actor EventStreamService {
    public enum ConnectionState: Sendable {
        case disconnected
        case connecting
        case connected
        case reconnecting(attempt: Int)
    }

    private let client: ControlAPIClient
    private var streamTask: Task<Void, Never>?
    private var eventContinuation: AsyncStream<SSEEvent>.Continuation?

    public private(set) var connectionState: ConnectionState = .disconnected
    public private(set) var lastEventAt: Date?

    private static let maxBackoffSeconds: Double = 30
    private static let baseBackoffSeconds: Double = 1

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func start() -> AsyncStream<SSEEvent> {
        stop()

        let (stream, continuation) = AsyncStream<SSEEvent>.makeStream()
        self.eventContinuation = continuation

        streamTask = Task { [weak self] in
            var attempt = 0
            while !Task.isCancelled {
                guard let self else { break }
                do {
                    await self.setConnectionState(.connecting)
                    let (bytes, _) = try await self.client.eventStreamBytes()
                    await self.setConnectionState(.connected)
                    attempt = 0

                    for await event in EventStreamParser.parse(bytes: bytes) {
                        if Task.isCancelled { break }
                        await self.setLastEventAt(.now)
                        continuation.yield(event)
                    }
                } catch {
                    if Task.isCancelled { break }
                    PopeyeLogger.events.error("SSE connection error: \(error)")
                }

                attempt += 1
                let backoff = min(
                    Self.baseBackoffSeconds * pow(2, Double(attempt - 1)),
                    Self.maxBackoffSeconds
                )
                await self.setConnectionState(.reconnecting(attempt: attempt))
                PopeyeLogger.events.info("SSE reconnecting in \(backoff)s (attempt \(attempt))")
                try? await Task.sleep(for: .seconds(backoff))
            }
            continuation.finish()
        }

        return stream
    }

    public func stop() {
        streamTask?.cancel()
        streamTask = nil
        eventContinuation?.finish()
        eventContinuation = nil
        connectionState = .disconnected
    }

    private func setConnectionState(_ state: ConnectionState) {
        connectionState = state
    }

    private func setLastEventAt(_ date: Date) {
        lastEventAt = date
    }
}
