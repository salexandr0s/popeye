import SwiftUI

struct TodoItemActionsSection: View {
    @Bindable var store: TodosStore

    var body: some View {
        InspectorSection(title: "Actions") {
            if store.selectedItem?.status != "pending" {
                Text("Completed and cancelled items are read-only in the native app.")
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 12) {
                    Button("Complete Todo", systemImage: "checkmark.circle.fill") {
                        Task { await store.completeSelectedItem() }
                    }
                    .disabled(!store.canCompleteSelectedItem)

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Priority")
                            .font(.subheadline.weight(.semibold))
                        Picker("Priority", selection: $store.draftPriority) {
                            ForEach(1...4, id: \.self) { priority in
                                Text("P\(priority)").tag(priority)
                            }
                        }
                        .pickerStyle(.segmented)

                        Button("Apply Priority") {
                            Task { await store.reprioritizeSelectedItem() }
                        }
                        .disabled(!store.canReprioritizeSelectedItem)
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Reschedule")
                            .font(.subheadline.weight(.semibold))
                        TextField("YYYY-MM-DD", text: $store.draftDueDate)
                            .textFieldStyle(.roundedBorder)
                        TextField("HH:MM (optional)", text: $store.draftDueTime)
                            .textFieldStyle(.roundedBorder)
                        if let validationMessage = store.rescheduleValidationMessage {
                            Text(validationMessage)
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Button("Apply Schedule") {
                            Task { await store.rescheduleSelectedItem() }
                        }
                        .disabled(!store.canRescheduleSelectedItem)
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Move to Project")
                            .font(.subheadline.weight(.semibold))
                        if store.availableMoveProjects.isEmpty {
                            Text("No alternate projects are available for this account.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            Picker("Project", selection: $store.moveTargetProjectName) {
                                Text("Choose project").tag(Optional<String>.none)
                                ForEach(store.availableMoveProjects) { project in
                                    Text(project.name).tag(Optional(project.name))
                                }
                            }
                            .pickerStyle(.menu)
                        }

                        Button("Move Todo") {
                            Task { await store.moveSelectedItem() }
                        }
                        .disabled(!store.canMoveSelectedItem)
                    }
                }
            }
        }
    }
}
