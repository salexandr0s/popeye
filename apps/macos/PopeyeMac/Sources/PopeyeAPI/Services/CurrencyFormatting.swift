import Foundation

public enum CurrencyFormatting {
    public static func formatCostUSD(_ amount: Double) -> String {
        let formattedAmount = amount.formatted(
            .number
                .locale(Locale(identifier: "en_US_POSIX"))
                .precision(.fractionLength(4))
        )
        return "$\(formattedAmount)"
    }
}
