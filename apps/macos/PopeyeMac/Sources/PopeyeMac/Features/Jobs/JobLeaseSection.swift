import SwiftUI
import PopeyeAPI

struct JobLeaseSection: View {
    let lease: JobLeaseDTO

    var body: some View {
        InspectorSection(title: "Lease") {
            DetailRow(label: "Owner", value: lease.leaseOwner)
            DetailRow(label: "Expires At", value: DateFormatting.formatAbsoluteTime(lease.leaseExpiresAt))
            DetailRow(label: "Updated", value: DateFormatting.formatAbsoluteTime(lease.updatedAt))
        }
    }
}
