import Foundation
import PopeyeAPI

@Observable @MainActor
final class EmailStore {
    var accounts: [EmailAccountDTO] = []
    var threads: [EmailThreadDTO] = []
    var digest: EmailDigestDTO?
    var selectedAccountID: String?
    var selectedThreadID: String?
    var selectedThread: EmailThreadDTO?
    var isLoading = false
    var error: APIError?
    var workspaceID = "default" {
        didSet {
            guard oldValue != workspaceID else { return }
            accounts = []
            threads = []
            selectedAccountID = nil
            selectedThreadID = nil
            selectedThread = nil
            digest = nil
        }
    }

    private let service: EmailDomainService

    init(client: ControlAPIClient) {
        self.service = EmailDomainService(client: client)
    }

    var activeAccount: EmailAccountDTO? {
        accounts.first { $0.id == selectedAccountID } ?? accounts.first
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
                async let loadedThreads = service.loadThreads(accountId: selectedAccountID)
                async let loadedDigest = service.loadDigest(accountId: selectedAccountID)
                threads = try await loadedThreads
                digest = try await loadedDigest
                selectedThreadID = selectedThreadID.flatMap { id in threads.contains(where: { $0.id == id }) ? id : nil } ?? threads.first?.id
                if let selectedThreadID {
                    selectedThread = try await service.loadThread(id: selectedThreadID)
                }
            } else {
                threads = []
                digest = nil
                selectedThread = nil
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
        isLoading = false
    }

    func loadThread(id: String) async {
        do {
            selectedThread = try await service.loadThread(id: id)
        } catch {
            PopeyeLogger.refresh.error("Email thread load failed: \(error)")
        }
    }
}
