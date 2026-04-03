import PopeyeAPI

extension MemoryPromotionProposalDTO: Identifiable {
    public var id: String {
        "\(memoryId)-\(targetPath)"
    }
}
