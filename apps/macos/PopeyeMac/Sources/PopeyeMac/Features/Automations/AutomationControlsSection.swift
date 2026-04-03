import SwiftUI
import PopeyeAPI

struct AutomationControlsSection: View {
    let detail: AutomationDetailDTO
    @Binding var enabled: Bool
    @Binding var cadenceText: String
    let cadenceValidationMessage: String?
    let hasPendingChanges: Bool
    let saveChanges: () -> Void

    var body: some View {
        InspectorSection(title: "Controls") {
            VStack(alignment: .leading, spacing: 12) {
                if detail.controls.enabledEdit {
                    Toggle(isOn: $enabled) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Enabled")
                            Text("Disable background execution without losing the automation.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .toggleStyle(.switch)
                }

                if detail.controls.cadenceEdit {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Cadence (seconds)")
                            .font(.headline)
                        TextField("3600", text: $cadenceText)
                            .textFieldStyle(.roundedBorder)
                            .frame(maxWidth: 160)
                        if let cadenceValidationMessage {
                            Text(cadenceValidationMessage)
                                .font(.caption)
                                .foregroundStyle(.orange)
                        } else {
                            Text(
                                detail.source == "heartbeat"
                                ? "Heartbeat cadence is saved back to the workspace heartbeat settings."
                                : "Interval-backed automations can update their cadence directly from here."
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                    }
                } else {
                    Text("Cadence editing is not available for this automation type.")
                        .foregroundStyle(.secondary)
                }

                if detail.controls.enabledEdit || detail.controls.cadenceEdit {
                    Button("Save Changes", action: saveChanges)
                        .buttonStyle(.borderedProminent)
                        .disabled(hasPendingChanges == false || cadenceValidationMessage != nil)
                        .help("Save automation control changes")
                }
            }
        }
    }
}
