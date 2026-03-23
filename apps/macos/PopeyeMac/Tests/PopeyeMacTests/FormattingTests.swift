import Testing
import Foundation
@testable import PopeyeAPI

@Suite("Formatting Utilities")
struct FormattingTests {

    // MARK: - Duration Formatting

    @Test("Format duration 0 seconds")
    func durationZero() {
        #expect(DurationFormatting.formatDuration(0) == "0s")
    }

    @Test("Format duration seconds only")
    func durationSeconds() {
        #expect(DurationFormatting.formatDuration(45) == "45s")
    }

    @Test("Format duration minutes and seconds")
    func durationMinutes() {
        #expect(DurationFormatting.formatDuration(750) == "12m 30s")
    }

    @Test("Format duration hours and minutes")
    func durationHours() {
        #expect(DurationFormatting.formatDuration(11700) == "3h 15m")
    }

    @Test("Format duration days and hours")
    func durationDays() {
        #expect(DurationFormatting.formatDuration(190800) == "2d 5h")
    }

    @Test("Format negative duration clamps to zero")
    func durationNegative() {
        #expect(DurationFormatting.formatDuration(-100) == "0s")
    }

    // MARK: - Currency Formatting

    @Test("Format zero cost")
    func costZero() {
        #expect(CurrencyFormatting.formatCostUSD(0) == "$0.0000")
    }

    @Test("Format typical cost")
    func costTypical() {
        #expect(CurrencyFormatting.formatCostUSD(3.45) == "$3.4500")
    }

    @Test("Format large cost")
    func costLarge() {
        #expect(CurrencyFormatting.formatCostUSD(125.1234) == "$125.1234")
    }

    // MARK: - Token Count Formatting

    @Test("Format zero tokens")
    func tokenCountZero() {
        #expect(IdentifierFormatting.formatTokenCount(0) == "0")
    }

    @Test("Format thousand tokens contains grouping")
    func tokenCountThousand() {
        let result = IdentifierFormatting.formatTokenCount(1000)
        // Locale-dependent separator (comma or period)
        #expect(result.contains("1") && result.count > 1)
        #expect(result != "1000") // Must have a grouping separator
    }

    @Test("Format large token count contains grouping")
    func tokenCountLarge() {
        let result = IdentifierFormatting.formatTokenCount(150000)
        #expect(result.contains("150"))
        #expect(result != "150000") // Must have a grouping separator
    }

    // MARK: - Short ID Formatting

    @Test("Short ID preserves short strings")
    func shortIDShort() {
        #expect(IdentifierFormatting.formatShortID("abc") == "abc")
    }

    @Test("Short ID truncates long strings")
    func shortIDLong() {
        #expect(IdentifierFormatting.formatShortID("abcdefghijklmnop") == "abcdefgh…")
    }

    // MARK: - Date Parsing

    @Test("Parse ISO 8601 with fractional seconds")
    func parseWithFractional() {
        let date = DateFormatting.parseISO8601("2026-03-22T10:00:00.123Z")
        #expect(date != nil)
    }

    @Test("Parse ISO 8601 without fractional seconds")
    func parseWithoutFractional() {
        let date = DateFormatting.parseISO8601("2026-03-22T10:00:00Z")
        #expect(date != nil)
    }

    @Test("Parse invalid string returns nil")
    func parseInvalid() {
        let date = DateFormatting.parseISO8601("not-a-date")
        #expect(date == nil)
    }

    // MARK: - Relative Time

    @Test("Relative time for invalid input")
    func relativeInvalid() {
        #expect(DateFormatting.formatRelativeTime("bad") == "--")
    }

    // MARK: - Absolute Time

    @Test("Absolute time for invalid input")
    func absoluteInvalid() {
        #expect(DateFormatting.formatAbsoluteTime("bad") == "--")
    }
}
