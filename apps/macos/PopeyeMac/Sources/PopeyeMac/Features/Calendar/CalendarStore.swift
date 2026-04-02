import Foundation
import PopeyeAPI

@Observable @MainActor
final class CalendarStore {
    var accounts: [CalendarAccountDTO] = []
    var events: [CalendarEventDTO] = []
    var digest: CalendarDigestDTO?
    var selectedAccountID: String?
    var selectedEventID: String?
    var selectedEvent: CalendarEventDTO?
    var isLoading = false
    var error: APIError?
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            accounts = []
            events = []
            selectedAccountID = nil
            selectedEventID = nil
            selectedEvent = nil
            digest = nil
        }
    }

    private let service: CalendarDomainService

    init(client: ControlAPIClient) {
        self.service = CalendarDomainService(client: client)
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            accounts = try await service.loadAccounts()
            if selectedAccountID == nil || accounts.contains(where: { $0.id == selectedAccountID }) == false {
                selectedAccountID = accounts.first?.id
            }
            if let selectedAccountID {
                let bounds = DateWindow.nextSevenDays()
                async let loadedEvents = service.loadEvents(accountId: selectedAccountID, dateFrom: bounds.from, dateTo: bounds.to)
                async let loadedDigest = service.loadDigest(accountId: selectedAccountID)
                events = try await loadedEvents
                digest = try await loadedDigest
                selectedEventID = selectedEventID.flatMap { id in events.contains(where: { $0.id == id }) ? id : nil } ?? events.first?.id
                if let selectedEventID {
                    selectedEvent = try await service.loadEvent(id: selectedEventID)
                }
            } else {
                events = []
                digest = nil
                selectedEvent = nil
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
        isLoading = false
    }

    func loadEvent(id: String) async {
        do {
            selectedEvent = try await service.loadEvent(id: id)
        } catch {
            PopeyeLogger.refresh.error("Calendar event load failed: \(error)")
        }
    }
}

private struct DateWindow {
    let from: String
    let to: String

    static func nextSevenDays() -> DateWindow {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: .now)
        let end = calendar.date(byAdding: .day, value: 7, to: start) ?? start
        return DateWindow(from: start.ISO8601Format(), to: end.ISO8601Format())
    }
}
