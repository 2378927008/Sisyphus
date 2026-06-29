import SwiftUI

@main
struct LocalFlowiOSApp: App {
    @StateObject private var model = SpeechDictationViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView(model: model)
                .onOpenURL { url in
                    Task {
                        await model.handleOpenURL(url)
                    }
                }
        }
    }
}
