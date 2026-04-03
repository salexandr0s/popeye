import SwiftUI

struct AutomationsHeader: View {
    let workspaceName: String
    @Binding var viewMode: AutomationStore.ViewMode

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                titleBlock
                Spacer()
                viewPicker
            }

            VStack(alignment: .leading, spacing: 12) {
                titleBlock
                viewPicker
            }
        }
        .padding(PopeyeUI.contentPadding)
        .background(.background.secondary)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(workspaceName)
                .font(.headline)
            Text("Recurring work and heartbeat health for the current workspace")
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var viewPicker: some View {
        Picker("View", selection: $viewMode) {
            ForEach(AutomationStore.ViewMode.allCases, id: \.self) { mode in
                Text(mode.rawValue.capitalized).tag(mode)
            }
        }
        .pickerStyle(.segmented)
        .frame(width: 180)
    }
}
