import Foundation
import PopeyeAPI

@Observable @MainActor
final class PeopleStore {
    var people: [PersonDTO] = []
    var mergeSuggestions: [PersonMergeSuggestionDTO] = []
    var selectedPersonID: String?
    var selectedPerson: PersonDTO?
    var personActivity: [PersonActivityRollupDTO] = []
    var mergeEvents: [PersonMergeEventDTO] = []
    var searchText = ""
    var isLoading = false
    var error: APIError?
    var isMutating = false
    var mutationMessage: String?
    var mutationErrorMessage: String?
    var attachProvider = "email"
    var attachExternalID = ""
    var attachDisplayName = ""
    var attachHandle = ""
    var splitDisplayName = ""
    var splitIdentityIDs: Set<String> = []

    private let service: PeopleService

    init(client: ControlAPIClient) {
        self.service = PeopleService(client: client)
    }

    var filteredPeople: [PersonDTO] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard query.isEmpty == false else { return people }
        return people.filter {
            $0.displayName.localizedStandardContains(query)
                || ($0.canonicalEmail?.localizedStandardContains(query) ?? false)
                || ($0.githubLogin?.localizedStandardContains(query) ?? false)
                || $0.tags.contains(where: { $0.localizedStandardContains(query) })
        }
    }

    var selectedSuggestions: [PersonMergeSuggestionDTO] {
        guard let selectedPersonID else { return [] }
        return mergeSuggestions.filter { $0.sourcePersonId == selectedPersonID || $0.targetPersonId == selectedPersonID }
    }

    var canAttachIdentity: Bool {
        guard let selectedPerson else { return false }
        return selectedPerson.id.isEmpty == false && attachExternalID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
    }

    var canSplitSelection: Bool {
        guard let selectedPerson else { return false }
        return splitIdentityIDs.isEmpty == false && splitIdentityIDs.count < selectedPerson.identities.count
    }

    func load() async {
        isLoading = true
        error = nil
        do {
            async let loadedPeople = service.loadPeople()
            async let loadedSuggestions = service.loadMergeSuggestions()
            people = try await loadedPeople
            mergeSuggestions = (try? await loadedSuggestions) ?? []
            ensureSelection()
            if let selectedPersonID {
                await loadPerson(id: selectedPersonID)
            }
        } catch let apiError as APIError {
            self.error = apiError
        } catch {
            self.error = .transportUnavailable
        }
        isLoading = false
    }

    func loadPerson(id: String) async {
        do {
            async let person = service.loadPerson(id: id)
            async let activity = service.loadActivity(id: id)
            async let events = service.loadMergeEvents(id: id)
            selectedPerson = try await person
            personActivity = (try? await activity) ?? []
            mergeEvents = (try? await events) ?? []
            syncSplitSelection()
        } catch {
            PopeyeLogger.refresh.error("People detail load failed: \(error)")
        }
    }

    func ensureSelection() {
        guard let first = filteredPeople.first else {
            selectedPersonID = nil
            selectedPerson = nil
            personActivity = []
            mergeEvents = []
            return
        }

        if let selectedPersonID,
           filteredPeople.contains(where: { $0.id == selectedPersonID }) {
            return
        }

        selectedPersonID = first.id
    }

    func setSplitIdentity(_ identityID: String, selected: Bool) {
        if selected {
            splitIdentityIDs.insert(identityID)
        } else {
            splitIdentityIDs.remove(identityID)
        }
        mutationErrorMessage = nil
    }

    func merge(_ suggestion: PersonMergeSuggestionDTO) async {
        beginMutation()
        do {
            let merged = try await service.merge(input: PersonMergeInput(
                sourcePersonId: suggestion.sourcePersonId,
                targetPersonId: suggestion.targetPersonId
            ))
            selectedPersonID = merged.id
            await load()
            mutationMessage = "Merged duplicate records into \(merged.displayName)."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func attachIdentity() async {
        guard let selectedPerson, canAttachIdentity else { return }
        beginMutation()
        do {
            let updated = try await service.attachIdentity(input: PersonIdentityAttachInput(
                personId: selectedPerson.id,
                provider: attachProvider,
                externalId: attachExternalID.trimmingCharacters(in: .whitespacesAndNewlines),
                displayName: trimmedOrNil(attachDisplayName),
                handle: trimmedOrNil(attachHandle)
            ))
            resetAttachDraft()
            selectedPersonID = updated.id
            await load()
            mutationMessage = "Attached a new \(attachProvider.capitalized) identity."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func detachIdentity(_ identityID: String) async {
        beginMutation()
        do {
            let updated = try await service.detachIdentity(id: identityID)
            selectedPersonID = updated.id
            await load()
            mutationMessage = "Detached identity from \(updated.displayName)."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    func splitSelectedIdentities() async {
        guard let selectedPerson, canSplitSelection else { return }
        beginMutation()
        do {
            let updated = try await service.split(personId: selectedPerson.id, input: PersonSplitInput(
                identityIds: Array(splitIdentityIDs).sorted(),
                displayName: trimmedOrNil(splitDisplayName)
            ))
            splitDisplayName = ""
            splitIdentityIDs.removeAll()
            selectedPersonID = updated.id
            await load()
            mutationMessage = "Split the selected identities into a new person record."
        } catch let apiError as APIError {
            mutationErrorMessage = apiError.userMessage
        } catch {
            mutationErrorMessage = error.localizedDescription
        }
        isMutating = false
    }

    private func beginMutation() {
        isMutating = true
        mutationMessage = nil
        mutationErrorMessage = nil
    }

    private func syncSplitSelection() {
        let validIDs = Set(selectedPerson?.identities.map(\.id) ?? [])
        splitIdentityIDs = splitIdentityIDs.intersection(validIDs)
    }

    private func resetAttachDraft() {
        attachExternalID = ""
        attachDisplayName = ""
        attachHandle = ""
    }

    private func trimmedOrNil(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
