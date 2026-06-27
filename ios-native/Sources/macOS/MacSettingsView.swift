import SwiftUI

// The Settings scene: server URL/token (shared with PDF + AI + sync), appearance,
// default citation style, and a manual sync control. Edits persist on change.
struct MacSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        Form {
            Section("Server") {
                TextField("API URL", text: $model.settings.apiUrl)
                    .textContentType(.URL)
                SecureField("API Token", text: $model.settings.apiToken)
                Text("The self-hosted data + AI server. PDFs and sync use the same host on :8443.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Appearance") {
                Picker("Theme", selection: $model.settings.theme) {
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                .pickerStyle(.segmented)
            }

            Section("Citations") {
                Picker("Default style", selection: $model.settings.defaultCite) {
                    ForEach(["APA", "MLA", "Chicago", "ieee", "nature", "BibTeX"], id: \.self) {
                        Text($0).tag($0)
                    }
                }
            }

            Section("Sync") {
                HStack {
                    Button("Sync Now") { Task { await model.syncNow() } }
                        .disabled(model.syncing)
                    if model.syncing { ProgressView().controlSize(.small) }
                    Spacer()
                    Text(model.syncStatus ?? "\(model.papers.count) papers")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .onChange(of: model.settings) { _, _ in model.persistSettings() }
    }
}
