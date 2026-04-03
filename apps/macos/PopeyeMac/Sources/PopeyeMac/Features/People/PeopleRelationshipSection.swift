import SwiftUI
import PopeyeAPI

struct PeopleRelationshipSection: View {
    let person: PersonDTO

    var body: some View {
        InspectorSection(title: "Relationship") {
            DetailRow(label: "Email", value: person.canonicalEmail ?? "Not set")
            DetailRow(label: "GitHub", value: person.githubLogin ?? "Not set")
            DetailRow(label: "Tags", value: person.tags.isEmpty ? "None" : person.tags.joined(separator: ", "))
            if let policy = person.policy {
                DetailRow(label: "Relationship", value: policy.relationshipLabel ?? "Not set")
                DetailRow(label: "Reminder Routing", value: policy.reminderRouting ?? "Not set")
            }
            if person.notes.isEmpty == false {
                Text(person.notes)
                    .foregroundStyle(.secondary)
            }
        }
    }
}
