import SwiftUI

// Settings: server URL/token (shared by data/PDF/AI/sync), AI model, semantic
// search (Voyage), read-aloud voice/rate, appearance, citations, and sync.
struct MacSettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model

        Form {
            Section("Server") {
                TextField("API URL", text: $model.settings.apiUrl)
                SecureField("API Token", text: $model.settings.apiToken)
                Text("The self-hosted data + AI server. PDFs and sync use the same host on :8443.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("AI") {
                TextField("Model (blank = default)", text: $model.settings.model)
            }

            Section("Semantic search (Voyage)") {
                Picker("Provider", selection: $model.settings.embedProvider) {
                    Text("Off").tag("off")
                    Text("Voyage").tag("voyage")
                }
                if model.settings.embedProvider == "voyage" {
                    TextField("Embed model", text: $model.settings.embedModel)
                    SecureField("Voyage API key", text: $model.settings.voyageKey)
                }
            }

            Section("Read aloud") {
                TextField("Voice", text: $model.settings.ttsVoice)
                HStack {
                    Text("Rate")
                    Slider(value: $model.settings.ttsRate, in: 0.5...2.0, step: 0.1)
                    Text(String(format: "%.1f×", model.settings.ttsRate)).monospacedDigit()
                        .foregroundStyle(.secondary)
                }
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
                    ForEach(CiteService.styles, id: \.id) { Text($0.label).tag($0.id) }
                }
            }

            Section("Sync") {
                Toggle("Auto-sync", isOn: $model.settings.syncAuto)
                HStack {
                    Button("Sync Now") { Task { await model.syncNow() } }
                        .disabled(model.syncing)
                    if model.syncing { ProgressView().controlSize(.small) }
                    Spacer()
                    Text(model.syncStatus ?? "\(model.papers.count) papers")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }

            Section("WebDAV (fallback)") {
                TextField("WebDAV URL", text: $model.settings.webdavUrl)
                TextField("User", text: $model.settings.webdavUser)
                SecureField("Password", text: $model.settings.webdavPass)
                SecureField("E2E passphrase", text: $model.settings.syncPassphrase)
            }
        }
        .formStyle(.grouped)
        .onChange(of: model.settings) { _, _ in model.persistSettings() }
    }
}
