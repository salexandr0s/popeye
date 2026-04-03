import SwiftUI
import PopeyeAPI

struct PeopleHeaderSection: View {
    let person: PersonDTO

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: PopeyeUI.sectionSpacing) {
                titleBlock
                Spacer(minLength: PopeyeUI.sectionSpacing)
                metricCards
                    .frame(maxWidth: 320)
            }

            VStack(alignment: .leading, spacing: PopeyeUI.sectionSpacing) {
                titleBlock
                metricCards
            }
        }
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(person.displayName)
                .font(.title2.bold())
            Text(person.activitySummary)
                .foregroundStyle(.secondary)
        }
    }

    private var metricCards: some View {
        LazyVGrid(columns: PopeyeUI.cardColumns(minimum: 130, maximum: 180), spacing: PopeyeUI.cardSpacing) {
            DashboardCard(label: "Identities", value: "\(person.identityCount)")
            DashboardCard(label: "Contacts", value: "\(person.contactMethodCount)")
        }
    }
}
