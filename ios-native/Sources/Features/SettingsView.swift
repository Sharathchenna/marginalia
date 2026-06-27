import SwiftUI

// Settings — native mirror of Settings.tsx (the subset relevant on iOS). The
// AI backend + Voyage key feed the services built in later phases.
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        Form {
            Section("Appearance") {
                Picker("Theme", selection: $model.settings.theme) {
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
                Picker("Default citation", selection: $model.settings.defaultCite) {
                    ForEach(["APA", "MLA", "Chicago", "BibTeX"], id: \.self) { Text($0).tag($0) }
                }
            }

            Section("AI backend") {
                TextField("Server URL (https://…)", text: $model.settings.apiUrl)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                    .keyboardType(.URL)
                SecureField("Token", text: $model.settings.apiToken)
                Text("Pre-configured for your self-hosted server (URL + token embedded). The server is Tailscale-private, so keep the Tailscale app connected on this device.")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Semantic search") {
                Picker("Embeddings", selection: $model.settings.embedProvider) {
                    Text("Off").tag("off")
                    Text("Voyage").tag("voyage")
                }
                if model.settings.embedProvider == "voyage" {
                    SecureField("Voyage API key", text: $model.settings.voyageKey)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                }
            }

            Section {
                TextField("WebDAV URL (snapshot file)", text: $model.settings.webdavUrl)
                    .textInputAutocapitalization(.never).autocorrectionDisabled().keyboardType(.URL)
                TextField("Username", text: $model.settings.webdavUser).textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Password", text: $model.settings.webdavPass)
                SecureField("Encryption passphrase (optional)", text: $model.settings.syncPassphrase)
                Toggle("Auto-sync on launch", isOn: $model.settings.syncAuto)
                Button {
                    Task { await model.syncNow() }
                } label: {
                    HStack {
                        if model.syncing { ProgressView().controlSize(.small) }
                        Text(model.syncing ? "Syncing…" : "Sync now")
                    }
                }.disabled(model.syncing || (model.settings.apiToken.isEmpty && model.settings.webdavUrl.isEmpty))
                if let s = model.syncStatus { Text(s).font(.caption).foregroundStyle(.secondary) }
            } header: {
                Text("Sync")
            } footer: {
                Text("With an AI backend set above, your library syncs per-record with the self-hosted server (and the desktop app) automatically. WebDAV below is an optional encrypted-snapshot fallback.")
            }

            Section("Library") {
                LabeledContent("Papers", value: "\(model.papers.count)")
                LabeledContent("Collections", value: "\(model.collections.count)")
                LabeledContent("Feeds", value: "\(model.feeds.count)")
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: model.settings) { _, _ in model.persistSettings() }
    }
}
