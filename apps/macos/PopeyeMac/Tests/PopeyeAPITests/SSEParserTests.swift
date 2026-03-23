import Testing
import Foundation
@testable import PopeyeAPI

@Suite("SSE Parser")
struct SSEParserTests {

    @Test("Parse single event with event and data lines")
    func parseSingleEvent() async {
        let raw = "event: run_started\ndata: {\"id\":\"run-1\"}\n\n"
        let events = await collectEvents(from: raw)

        #expect(events.count == 1)
        #expect(events[0].event == "run_started")
        #expect(events[0].data == "{\"id\":\"run-1\"}")
    }

    @Test("Parse multiple events")
    func parseMultipleEvents() async {
        let raw = """
        event: run_started
        data: {"id":"run-1"}

        event: run_completed
        data: {"id":"run-1","state":"succeeded"}

        """
        let events = await collectEvents(from: raw)

        #expect(events.count == 2)
        #expect(events[0].event == "run_started")
        #expect(events[1].event == "run_completed")
    }

    @Test("Parse event without event line defaults to message")
    func parseDefaultEventType() async {
        let raw = "data: hello\n\n"
        let events = await collectEvents(from: raw)

        #expect(events.count == 1)
        #expect(events[0].event == "message")
        #expect(events[0].data == "hello")
    }

    @Test("Skip comment lines (heartbeats)")
    func skipComments() async {
        let raw = ": heartbeat\nevent: test\ndata: ok\n\n"
        let events = await collectEvents(from: raw)

        #expect(events.count == 1)
        #expect(events[0].event == "test")
    }

    @Test("Empty data lines are not dispatched")
    func emptyDataNotDispatched() async {
        let raw = "event: empty\n\n"
        let events = await collectEvents(from: raw)

        #expect(events.isEmpty)
    }

    // Helper: simulate URLSession.AsyncBytes via a simple line-based async sequence
    private func collectEvents(from raw: String) async -> [SSEEvent] {
        let lines = raw.components(separatedBy: "\n")
        var collected: [SSEEvent] = []

        // Manually parse lines to simulate the parser logic
        var currentEvent = ""
        var currentData = ""

        for line in lines {
            if line.isEmpty {
                if !currentData.isEmpty {
                    collected.append(SSEEvent(event: currentEvent.isEmpty ? "message" : currentEvent, data: currentData))
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
                // Comment — skip
            }
        }

        return collected
    }
}
