import LocalFlowCore
import SwiftUI
import UIKit

struct ContentView: View {
    @ObservedObject var model: SpeechDictationViewModel
    @State private var shareText = ""

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                providerHeader
                languageControls
                recordButton
                resultEditor
                actions
                historyList
            }
            .padding()
            .navigationTitle("Local Flow")
            .task {
                await model.requestPermissions()
            }
        }
    }

    private var providerHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("System Apple Speech")
                .font(.headline)
            Text(model.statusText)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private var languageControls: some View {
        VStack(spacing: 12) {
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

    private var recordButton: some View {
        Button {
            Task {
                await model.toggleRecording()
            }
        } label: {
            Text(model.isRecording ? "Stop" : "Record")
                .font(.title2.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: 72)
        }
        .buttonStyle(.borderedProminent)
        .disabled(!model.canRecord)
    }

    private var resultEditor: some View {
        TextEditor(text: $model.editableText)
            .frame(minHeight: 180)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(.quaternary)
            )
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

            List(model.history.prefix(5)) { item in
                Button {
                    model.editableText = item.text
                } label: {
                    VStack(alignment: .leading) {
                        Text(item.text)
                            .lineLimit(2)
                        Text(item.createdAt, style: .time)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .frame(minHeight: 160)
        }
    }
}
