import SwiftUI

struct FreshnessPill: View {
    let lastUpdated: Date?
    var staleThreshold: TimeInterval = 20

    @State private var isStale = false

    var body: some View {
        Text(isStale ? "Stale" : "Fresh")
            .font(.caption.bold())
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(isStale ? Color.orange.opacity(0.1) : Color.green.opacity(0.1))
            .foregroundStyle(isStale ? .orange : .green)
            .clipShape(.capsule)
            .task(id: lastUpdated) {
                updateStaleness()
            }
            .task {
                // Re-check staleness every 5 seconds
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(5))
                    updateStaleness()
                }
            }
    }

    private func updateStaleness() {
        guard let lastUpdated else {
            isStale = true
            return
        }
        isStale = Date.now.timeIntervalSince(lastUpdated) > staleThreshold
    }
}

#Preview {
    HStack {
        FreshnessPill(lastUpdated: .now)
        FreshnessPill(lastUpdated: .now.addingTimeInterval(-30))
        FreshnessPill(lastUpdated: nil)
    }
    .padding()
}
