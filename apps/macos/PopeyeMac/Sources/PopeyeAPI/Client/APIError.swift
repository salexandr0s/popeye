import Foundation

public enum APIError: Error, Equatable, Sendable {
    case transportUnavailable
    case unauthorized
    case forbidden
    case csrfInvalid
    case notFound
    case decodeFailure(message: String)
    case apiFailure(statusCode: Int, message: String)



    public static func from(_ error: any Error) -> APIError {
        if let apiError = error as? APIError {
            return apiError
        }

        if let decodingError = error as? DecodingError {
            return .decodeFailure(message: decodingError.localizedDescription)
        }

        return .apiFailure(statusCode: -1, message: error.localizedDescription)
    }
    public var userMessage: String {
        switch self {
        case .transportUnavailable:
            "Cannot reach the Popeye daemon. Is it running?"
        case .unauthorized:
            "Invalid or expired authentication credentials."
        case .forbidden:
            "Your token does not have permission for this action."
        case .csrfInvalid:
            "CSRF validation failed. Try again."
        case .notFound:
            "The requested resource was not found."
        case .decodeFailure(let message):
            "Unexpected response format: \(message)"
        case .apiFailure(let code, let message):
            "API error \(code): \(message)"
        }
    }
}
