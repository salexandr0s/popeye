import PopeyeAPI

enum ScreenLoadPhase: Equatable {
    case idle
    case loading
    case loaded
    case empty
    case failed(APIError)

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var error: APIError? {
        if case .failed(let error) = self { return error }
        return nil
    }
}

enum ScreenOperationPhase: Equatable {
    case idle
    case loading
    case failed(APIError)

    var isLoading: Bool {
        if case .loading = self { return true }
        return false
    }

    var error: APIError? {
        if case .failed(let error) = self { return error }
        return nil
    }
}
