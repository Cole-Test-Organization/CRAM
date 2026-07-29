import SwiftUI

struct MobileSettingsView: View {
    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var serverURL = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("CRAM server") {
                    TextField("https://crm.example.com", text: $serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text(
                        "The app shell always launches locally. Only API traffic uses this endpoint."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }

                Section("Offline data") {
                    LabeledContent(
                        "Storage profile",
                        value: EndpointIdentity.storageKey(
                            for: model.session.configuration.serverURL
                        )
                    )
                    Text(
                        "Each server gets an isolated WebKit profile and native response cache. Changing servers never replays another server's snapshot."
                    )
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("CRAM Mobile")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        save()
                    }
                }
            }
            .onAppear {
                serverURL = model.session.configuration.serverURL.absoluteString
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        do {
            try model.updateServerURL(serverURL)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
