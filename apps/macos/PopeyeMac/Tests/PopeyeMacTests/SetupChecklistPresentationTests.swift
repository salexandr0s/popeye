import Testing
@testable import PopeyeMac

@Suite("Setup Checklist Presentation")
struct SetupChecklistPresentationTests {
    @Test("Checklist summary reflects remaining setup work")
    func summaryShowsRemainingItems() {
        let cards = [
            makeCard(id: .daemon, state: .connected),
            makeCard(id: .github, state: .missing),
            makeCard(id: .gmail, state: .missing)
        ]

        let presentation = SetupChecklistPresentation(cards: cards, selectedCardID: nil)

        #expect(presentation.completedCount == 1)
        #expect(presentation.summary == "2 setup items still need attention.")
        #expect(presentation.selectedCard?.id == .daemon)
    }

    @Test("Reauthorization summary takes precedence over generic remaining-work messaging")
    func summaryPrefersReauthorizationWarning() {
        let cards = [
            makeCard(id: .daemon, state: .connected),
            makeCard(id: .googleCalendar, state: .reauthRequired),
            makeCard(id: .telegram, state: .missing)
        ]

        let presentation = SetupChecklistPresentation(cards: cards, selectedCardID: .googleCalendar)

        #expect(presentation.summary == "At least one provider needs reauthorization before setup is complete.")
        #expect(presentation.selectedCard?.id == .googleCalendar)
    }

    @Test("Missing selection falls back to the first card and bootstrapping state ignores the daemon row")
    func fallbackSelectionAndLoadingState() {
        let cards = [
            makeCard(id: .daemon, state: .connected),
            makeCard(id: .github, state: .missing),
            makeCard(id: .gmail, state: .missing)
        ]

        let loadingPresentation = SetupChecklistPresentation(cards: cards, selectedCardID: .telegram)
        #expect(loadingPresentation.selectedCard?.id == .daemon)
        #expect(loadingPresentation.shouldShowLoadingState)

        let loadedPresentation = SetupChecklistPresentation(
            cards: [
                makeCard(id: .daemon, state: .connected),
                makeCard(id: .github, state: .connected),
                makeCard(id: .gmail, state: .missing)
            ],
            selectedCardID: .telegram
        )
        #expect(loadedPresentation.shouldShowLoadingState == false)
    }

    private func makeCard(id: SetupCardID, state: SetupCardState) -> SetupCard {
        SetupCard(
            id: id,
            state: state,
            summary: "",
            guidance: "",
            detailRows: [],
            followUpRows: [],
            followUpFootnote: nil,
            primaryAction: nil,
            supplementaryActions: [],
            destination: nil
        )
    }
}
