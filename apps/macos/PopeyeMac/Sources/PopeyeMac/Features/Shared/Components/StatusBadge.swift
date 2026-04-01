import SwiftUI

struct StatusBadge: View {
    let state: String

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(state.replacing("_", with: " ").capitalized)
                .font(.caption)
                .fontWeight(.medium)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(color.opacity(0.1))
        .clipShape(.capsule)
    }

    private var color: Color {
        Self.colorForState(state)
    }

    static func colorForState(_ state: String) -> Color {
        switch state.lowercased() {
        case "running", "starting", "active", "sending":
            .blue
        case "succeeded", "approved", "resolved", "connected", "sent", "healthy", "ready", "configured":
            .green
        case "failed", "failed_retryable", "failed_final", "failed_permanent", "failed_transient", "permanent_failure", "denied", "revoked", "stuck-risk", "error":
            .red
        case "paused", "blocked_operator", "idle", "open", "pending", "needs_auth", "warn", "uncertain", "ambiguous", "retryable_failure", "degraded", "reauth_required", "expired", "invalid_scopes", "stale", "partial", "incomplete":
            .orange
        case "cancelled", "abandoned", "queued", "waiting_retry", "leased", "closed", "info", "missing", "disabled", "unknown":
            .secondary
        default:
            .secondary
        }
    }
}

#Preview {
    VStack(spacing: 8) {
        StatusBadge(state: "running")
        StatusBadge(state: "succeeded")
        StatusBadge(state: "failed")
        StatusBadge(state: "paused")
        StatusBadge(state: "cancelled")
    }
    .padding()
}
