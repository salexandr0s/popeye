import Foundation

public enum ResponseDecoder {
    public static func makeDecoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        decoder.dateDecodingStrategy = .custom(decodeFlexibleISO8601)
        return decoder
    }

    private static func decodeFlexibleISO8601(_ decoder: any Decoder) throws -> Date {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)

        // Try ISO 8601 with fractional seconds
        if let date = try? Date(string, strategy: .iso8601.year().month().day()
            .time(includingFractionalSeconds: true).timeZone(separator: .omitted)) {
            return date
        }

        // Fall back to standard ISO 8601
        if let date = try? Date(string, strategy: .iso8601) {
            return date
        }

        throw DecodingError.dataCorruptedError(
            in: container,
            debugDescription: "Cannot decode date from: \(string)"
        )
    }
}
