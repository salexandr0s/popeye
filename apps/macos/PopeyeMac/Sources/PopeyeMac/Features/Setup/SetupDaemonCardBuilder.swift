import PopeyeAPI

enum SetupDaemonCardBuilder {
    static func makeCard(session: SetupSessionSnapshot) -> SetupCard {
        let state: SetupCardState
        let summary: String
        let guidance: String
        let sessionLabel: String

        switch session.connectionState {
        case .connected:
            state = .connected
            summary = "Connected to the loopback control API."
            guidance = session.sseConnected
                ? "Live updates are active for this app session."
                : "Connected without live updates. Refresh still uses the control API."
            sessionLabel = "Connected"
        case .connecting:
            state = .degraded
            summary = "Connecting to the daemon."
            guidance = "Wait for health checks to complete before reviewing provider setup."
            sessionLabel = "Connecting"
        case .disconnected:
            state = .missing
            summary = "Not connected to the daemon."
            guidance = "Reconnect from the welcome screen to load setup and brain data."
            sessionLabel = "Disconnected"
        case .failed(let error):
            state = .degraded
            summary = "The app could not validate the daemon session."
            guidance = error.userMessage
            sessionLabel = "Failed"
        }

        return SetupCard(
            id: .daemon,
            state: state,
            summary: summary,
            guidance: guidance,
            detailRows: [
                SetupCardDetail(label: "Base URL", value: session.baseURL),
                SetupCardDetail(label: "Session", value: sessionLabel),
                SetupCardDetail(label: "Live Updates", value: session.sseConnected ? "Connected" : "Not connected"),
            ],
            followUpRows: [],
            followUpFootnote: nil,
            primaryAction: nil,
            supplementaryActions: [],
            destination: nil
        )
    }
}
