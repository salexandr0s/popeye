import SwiftUI
import PopeyeAPI

struct PeopleDetailPane: View {
    @Bindable var store: PeopleStore

    var body: some View {
        if let person = store.selectedPerson {
            ScrollView {
                VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                    PeopleHeaderSection(person: person)
                    mutationBanner
                    PeopleRelationshipSection(person: person)
                    PeopleIdentitiesSection(store: store, person: person)
                    PeopleContactMethodsSection(person: person)
                    PeopleActivitySection(activity: store.personActivity)
                    PeopleRepairSection(store: store, person: person)
                    PeopleMergeSignalsSection(store: store)
                }
                .padding(PopeyeUI.contentPadding)
            }
        } else {
            ContentUnavailableView("Select a person", systemImage: "person.crop.circle.badge.2")
                .frame(maxWidth: .infinity, minHeight: 320)
        }
    }

    @ViewBuilder
    private var mutationBanner: some View {
        if let message = store.mutationMessage {
            Label(message, systemImage: "checkmark.circle.fill")
                .font(.callout)
                .foregroundStyle(.green)
        } else if let message = store.mutationErrorMessage {
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .font(.callout)
                .foregroundStyle(.orange)
        }
    }
}
