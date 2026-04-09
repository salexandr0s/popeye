import SwiftUI

struct CalendarEventSheet: View {
    @Bindable var store: CalendarStore

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(sheetTitle)
                .font(.title3.bold())
                .padding(20)

            Form {
                TextField("Title", text: titleBinding)
                TextField("Description", text: descriptionBinding, axis: .vertical)
                    .lineLimit(3...5)
                TextField("Location", text: locationBinding)
                DatePicker("Starts", selection: startDateBinding)
                DatePicker("Ends", selection: endDateBinding)
                TextField("Attendees (comma or newline separated)", text: attendeesBinding, axis: .vertical)
                    .lineLimit(2...4)

                if let editor = store.editor, editor.mode == .edit {
                    Picker("Status", selection: statusBinding) {
                        Text("Confirmed").tag("confirmed")
                        Text("Tentative").tag("tentative")
                        Text("Cancelled").tag("cancelled")
                    }
                    .pickerStyle(.menu)
                }

                if let validation = store.editorValidationMessage {
                    Text(validation)
                        .foregroundStyle(.secondary)
                }
            }
            .formStyle(.grouped)

            Divider()

            HStack {
                Spacer()
                Button("Cancel", role: .cancel) {
                    store.cancelEditor()
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)

                Button(primaryActionTitle) {
                    Task {
                        await store.saveEditor()
                        if store.editor == nil {
                            dismiss()
                        }
                    }
                }
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.borderedProminent)
                .disabled(!store.canSaveEditor)
            }
            .padding(20)
        }
        .frame(width: 520, height: 420)
    }

    private var sheetTitle: String {
        store.editor?.mode == .edit ? "Edit Event" : "New Event"
    }

    private var primaryActionTitle: String {
        store.editor?.mode == .edit ? "Save Changes" : "Create Event"
    }

    private var titleBinding: Binding<String> {
        Binding(
            get: { store.editor?.title ?? "" },
            set: { store.editor?.title = $0 }
        )
    }

    private var descriptionBinding: Binding<String> {
        Binding(
            get: { store.editor?.description ?? "" },
            set: { store.editor?.description = $0 }
        )
    }

    private var locationBinding: Binding<String> {
        Binding(
            get: { store.editor?.location ?? "" },
            set: { store.editor?.location = $0 }
        )
    }

    private var startDateBinding: Binding<Date> {
        Binding(
            get: { store.editor?.startDate ?? .now },
            set: { store.editor?.startDate = $0 }
        )
    }

    private var endDateBinding: Binding<Date> {
        Binding(
            get: { store.editor?.endDate ?? .now.addingTimeInterval(60 * 60) },
            set: { store.editor?.endDate = $0 }
        )
    }

    private var attendeesBinding: Binding<String> {
        Binding(
            get: { store.editor?.attendeesText ?? "" },
            set: { store.editor?.attendeesText = $0 }
        )
    }

    private var statusBinding: Binding<String> {
        Binding(
            get: { store.editor?.status ?? "confirmed" },
            set: { store.editor?.status = $0 }
        )
    }
}
