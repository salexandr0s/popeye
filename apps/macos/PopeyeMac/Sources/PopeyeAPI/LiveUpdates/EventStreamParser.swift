import Foundation

public struct SSEEvent: Sendable {
    public let event: String
    public let data: String

    public init(event: String, data: String) {
        self.event = event
        self.data = data
    }
}

public enum EventStreamParser {
    public static func parse(bytes: URLSession.AsyncBytes) -> AsyncStream<SSEEvent> {
        AsyncStream { continuation in
            let task = Task {
                var currentEvent = ""
                var currentData = ""

                for try await line in bytes.lines {
                    if Task.isCancelled { break }

                    if line.isEmpty {
                        // Empty line = dispatch event
                        if !currentData.isEmpty {
                            let event = SSEEvent(
                                event: currentEvent.isEmpty ? "message" : currentEvent,
                                data: currentData
                            )
                            continuation.yield(event)
                        }
                        currentEvent = ""
                        currentData = ""
                    } else if line.hasPrefix("event:") {
                        currentEvent = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                    } else if line.hasPrefix("data:") {
                        let value = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        if currentData.isEmpty {
                            currentData = value
                        } else {
                            currentData += "\n" + value
                        }
                    } else if line.hasPrefix(":") {
                        // Comment / heartbeat — ignore
                    }
                }
                continuation.finish()
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}
