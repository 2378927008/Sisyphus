import LocalFlowCore
import SwiftUI
import UIKit

struct ContentView: View {
    @ObservedObject var model: SpeechDictationViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    providerHeader
                    recordingSurface
                    resultEditor
                    actions
                    languageControls
                    deviceReadinessPanel
                    keyboardSetupGuide
                    historyList
                }
                .padding()
            }
            .navigationTitle("Local Flow")
            .task {
                await model.requestPermissions()
            }
        }
    }

    private var providerHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Voice Input")
                .font(.title2.weight(.semibold))
            Text(model.statusText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var languageControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Language")
                .font(.headline)

            HStack {
                Picker("Recognition", selection: $model.settings.recognitionLanguage) {
                    ForEach(RecognitionLanguage.allCases) { language in
                        Text(language.rawValue).tag(language)
                    }
                }
                .pickerStyle(.menu)

                Picker("Output", selection: $model.settings.outputSelection) {
                    ForEach(LocalFlowLanguage.supportedOutputLanguages) { language in
                        Text(language.rawValue).tag(language)
                    }
                }
                .pickerStyle(.menu)
            }
        }
    }

    private var recordingSurface: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(model.isRecording ? "Listening" : "Ready to dictate")
                        .font(.headline)
                    Text("System Apple Speech")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Spacer()

                Circle()
                    .fill(model.isRecording ? Color.red : Color.accentColor)
                    .frame(width: 12, height: 12)
            }

            Button {
                Task {
                    await model.toggleRecording()
                }
            } label: {
                Text(model.isRecording ? "Stop Dictation" : "Start Dictation")
                    .font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 68)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canRecord)
        }
    }

    private var resultEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Result")
                .font(.headline)
            ZStack(alignment: .topLeading) {
                TextEditor(text: $model.editableText)
                    .frame(minHeight: 180)
                    .padding(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(.quaternary)
                    )

                if model.editableText.isEmpty {
                    emptyResultState
                        .padding(14)
                        .allowsHitTesting(false)
                }
            }
        }
    }

    private var emptyResultState: some View {
        Text("Dictate first, then edit or share the result here.")
            .font(.subheadline)
            .foregroundStyle(.tertiary)
    }

    private var actions: some View {
        HStack {
            Button("Copy") {
                UIPasteboard.general.string = model.editableText
                model.statusText = "Copied to clipboard."
            }
            .disabled(model.editableText.isEmpty)

            ShareLink(item: model.editableText) {
                Text("Share")
            }
            .disabled(model.editableText.isEmpty)
        }
    }

    private var deviceReadinessPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Device setup")
                    .font(.headline)
                Spacer()
                Button("Open iPhone Settings") {
                    openSystemSettings()
                }
                .font(.subheadline)
            }

            ForEach(model.deviceReadinessItems) { item in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: item.isReady ? "checkmark.circle.fill" : "exclamationmark.circle")
                        .foregroundStyle(item.isReady ? .green : .orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.title)
                            .font(.subheadline.weight(.semibold))
                        Text(item.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    private var keyboardSetupGuide: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Enable Local Flow Keyboard")
                .font(.headline)
            Text("Settings > General > Keyboard > Keyboards > Add New Keyboard > Local Flow Keyboard, then enable Allow Full Access.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var historyList: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Recent dictation")
                    .font(.headline)
                Spacer()
                Button("Clear history") {
                    model.clearHistory()
                }
                .disabled(model.history.isEmpty)
            }

            if model.history.isEmpty {
                Text("No recent dictation yet.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.history.prefix(5)) { item in
                    historyRow(for: item)
                }
            }
        }
    }

    private func historyRow(for item: DictationHistoryItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(item.text)
                .font(.subheadline)
                .lineLimit(2)
            Text(item.createdAt, style: .time)
                .font(.caption)
                .foregroundStyle(.secondary)

            HStack {
                Button("Use") {
                    model.useHistoryItem(item)
                }
                Button("Copy") {
                    UIPasteboard.general.string = item.text
                    model.statusText = "Copied history item."
                }
            }
            .font(.caption.weight(.semibold))
        }
        .padding(.vertical, 6)
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }
}
