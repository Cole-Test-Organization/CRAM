import Foundation

struct MeetingNoteRequest: Identifiable {
    let meetingID: Int
    var id: Int { meetingID }
}

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var session: ClientSession
    @Published var meetingNoteRequest: MeetingNoteRequest?
    @Published var settingsPresented = false

    private let configurationStore: ServerConfigurationStore
    private let applicationSupportRoot: URL
    private let resourceRoot: URL

    init(
        configurationStore: ServerConfigurationStore = ServerConfigurationStore(),
        applicationSupportRoot: URL? = nil,
        resourceRoot: URL? = nil
    ) {
        self.configurationStore = configurationStore
        self.applicationSupportRoot = applicationSupportRoot
            ?? FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first!
        self.resourceRoot = resourceRoot
            ?? Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
        self.session = ClientSession(
            configuration: configurationStore.load(),
            applicationSupportRoot: self.applicationSupportRoot,
            resourceRoot: self.resourceRoot
        )
    }

    func openMeetingNotes(_ meetingID: Int) {
        guard meetingID > 0 else { return }
        settingsPresented = false
        meetingNoteRequest = MeetingNoteRequest(meetingID: meetingID)
    }

    func openSettings() {
        meetingNoteRequest = nil
        settingsPresented = true
    }

    func updateServerURL(_ rawValue: String) throws {
        let configuration = try ServerConfiguration(rawValue: rawValue)
        configurationStore.save(configuration)
        session = ClientSession(
            configuration: configuration,
            applicationSupportRoot: applicationSupportRoot,
            resourceRoot: resourceRoot
        )
        settingsPresented = false
        meetingNoteRequest = nil
    }
}
