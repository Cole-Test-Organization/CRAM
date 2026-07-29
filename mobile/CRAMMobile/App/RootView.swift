import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        CRAMWebView(
            session: model.session,
            initialPath: "/",
            onOpenMeetingNotes: model.openMeetingNotes,
            onOpenSettings: model.openSettings
        )
        .id(model.session.id)
        .ignoresSafeArea(.container, edges: .bottom)
        .sheet(isPresented: $model.settingsPresented) {
            MobileSettingsView()
                .environmentObject(model)
        }
        .sheet(item: $model.meetingNoteRequest) { request in
            NavigationStack {
                CRAMWebView(
                    session: model.session,
                    initialPath: "/client/meeting-notes/\(request.meetingID)",
                    onOpenMeetingNotes: model.openMeetingNotes,
                    onOpenSettings: model.openSettings
                )
                .navigationTitle("Meeting notes")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") {
                            model.meetingNoteRequest = nil
                        }
                    }
                }
            }
            .presentationDetents([.large])
        }
    }
}
