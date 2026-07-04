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
            .navigationTitle(model.copy.appTitle)
            .task {
                await model.requestPermissions()
            }
            .onChange(of: model.settings) { _, _ in
                model.saveSettings()
            }
            .onChange(of: model.settings.interfaceLanguage) { _, _ in
                model.refreshInterfaceLanguage()
            }
        }
    }

    private var providerHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(model.copy.voiceInput)
                .font(.title2.weight(.semibold))
            Text(model.statusText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var languageControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(model.copy.language)
                .font(.headline)

            VStack(alignment: .leading, spacing: 8) {
                Picker(model.copy.interfaceLanguage, selection: $model.settings.interfaceLanguage) {
                    ForEach(LocalFlowLanguage.supportedInterfaceLanguages) { language in
                        Text(language.displayName).tag(language)
                    }
                }
                .pickerStyle(.menu)

                Picker(model.copy.recognitionLanguage, selection: $model.settings.recognitionLanguage) {
                    ForEach(RecognitionLanguage.allCases) { language in
                        Text(language.displayName).tag(language)
                    }
                }
                .pickerStyle(.menu)

                Picker(model.copy.outputLanguage, selection: $model.settings.outputSelection) {
                    ForEach(LocalFlowLanguage.supportedOutputLanguages) { language in
                        Text(language.displayName).tag(language)
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
                    Text(model.isRecording ? model.copy.listening : model.copy.readyToDictate)
                        .font(.headline)
                    Text(model.copy.systemAppleSpeech)
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
                Text(model.isRecording ? model.copy.stopDictation : model.copy.startDictation)
                    .font(.title3.weight(.semibold))
                    .frame(maxWidth: .infinity, minHeight: 68)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!model.canRecord)
        }
    }

    private var resultEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.copy.result)
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
        Text(model.copy.emptyResult)
            .font(.subheadline)
            .foregroundStyle(.tertiary)
    }

    private var actions: some View {
        HStack {
            Button(model.copy.copyAction) {
                UIPasteboard.general.string = model.editableText
                model.statusText = model.copy.copiedToClipboard
            }
            .disabled(model.editableText.isEmpty)

            ShareLink(item: model.editableText) {
                Text(model.copy.shareAction)
            }
            .disabled(model.editableText.isEmpty)
        }
    }

    private var deviceReadinessPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(model.copy.deviceSetup)
                    .font(.headline)
                Spacer()
                Button(model.copy.openIPhoneSettings) {
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
            Text(model.copy.keyboardSetupTitle)
                .font(.headline)
            Text(model.copy.keyboardSetupDetail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var historyList: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(model.copy.recentDictation)
                    .font(.headline)
                Spacer()
                Button(model.copy.clearHistory) {
                    model.clearHistory()
                }
                .disabled(model.history.isEmpty)
            }

            if model.history.isEmpty {
                Text(model.copy.noRecentDictation)
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
                Button(model.copy.useAction) {
                    model.useHistoryItem(item)
                }
                Button(model.copy.copyAction) {
                    UIPasteboard.general.string = item.text
                    model.statusText = model.copy.copiedHistoryItem
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
