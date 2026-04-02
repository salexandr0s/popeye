import Foundation

public struct PeopleService: Sendable {
    private let client: ControlAPIClient

    public init(client: ControlAPIClient) {
        self.client = client
    }

    public func loadPeople() async throws -> [PersonDTO] {
        try await client.listPeople()
    }

    public func search(query: String, limit: Int = 20) async throws -> PersonSearchResponseDTO {
        try await client.searchPeople(query: query, limit: limit)
    }

    public func loadPerson(id: String) async throws -> PersonDTO {
        try await client.getPerson(id: id)
    }

    public func loadMergeSuggestions() async throws -> [PersonMergeSuggestionDTO] {
        try await client.listPersonMergeSuggestions()
    }

    public func loadMergeEvents(id: String) async throws -> [PersonMergeEventDTO] {
        try await client.listPersonMergeEvents(id: id)
    }

    public func loadActivity(id: String) async throws -> [PersonActivityRollupDTO] {
        try await client.listPersonActivity(id: id)
    }

    public func merge(input: PersonMergeInput) async throws -> PersonDTO {
        try await client.mergePeople(input: input)
    }

    public func split(personId: String, input: PersonSplitInput) async throws -> PersonDTO {
        try await client.splitPerson(id: personId, input: input)
    }

    public func attachIdentity(input: PersonIdentityAttachInput) async throws -> PersonDTO {
        try await client.attachPersonIdentity(input: input)
    }

    public func detachIdentity(id: String) async throws -> PersonDTO {
        try await client.detachPersonIdentity(id: id)
    }
}
