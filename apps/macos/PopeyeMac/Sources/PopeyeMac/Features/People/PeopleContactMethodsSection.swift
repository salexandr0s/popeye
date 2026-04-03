import SwiftUI
import PopeyeAPI

struct PeopleContactMethodsSection: View {
    let person: PersonDTO

    var body: some View {
        InspectorSection(title: "Contact Methods") {
            if person.contactMethods.isEmpty {
                Text("No contact methods recorded")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(person.contactMethods) { method in
                    DetailRow(label: method.type.capitalized, value: method.value)
                }
            }
        }
    }
}
