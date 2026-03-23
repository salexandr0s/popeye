import Foundation

public enum CurrencyFormatting {
    public static func formatCostUSD(_ amount: Double) -> String {
        String(format: "$%.4f", amount)
    }
}
