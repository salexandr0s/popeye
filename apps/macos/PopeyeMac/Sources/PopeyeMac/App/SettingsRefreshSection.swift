import SwiftUI

struct SettingsRefreshSection: View {
    @Binding var sseEnabled: Bool
    @Binding var pollIntervalSeconds: Int

    var body: some View {
        Section("Refresh") {
            Toggle("Enable SSE live updates", isOn: $sseEnabled)

            Picker("Fallback poll interval", selection: $pollIntervalSeconds) {
                Text("5 seconds").tag(5)
                Text("10 seconds").tag(10)
                Text("15 seconds").tag(15)
                Text("30 seconds").tag(30)
            }
        }
    }
}
