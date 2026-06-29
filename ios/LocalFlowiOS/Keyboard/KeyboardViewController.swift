import UIKit

final class KeyboardViewController: UIInputViewController {
    private let appGroupIdentifier = "group.com.localflow.dictation"
    private let latestResultKey = "latestResultText"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        let insertButton = makeButton(title: "Insert Latest", action: #selector(insertLatestResult))
        let dictateButton = makeButton(title: "Dictate", action: #selector(openHostApp))

        let stack = UIStackView(arrangedSubviews: [insertButton, dictateButton])
        stack.axis = .horizontal
        stack.spacing = 8
        stack.distribution = .fillEqually
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8)
        ])
    }

    private func makeButton(title: String, action: Selector) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(title, for: .normal)
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.addTarget(self, action: action, for: .touchUpInside)
        return button
    }

    @objc private func insertLatestResult() {
        let proxy: UITextDocumentProxy = textDocumentProxy
        let sharedDefaults = UserDefaults(suiteName: appGroupIdentifier)
        let text = sharedDefaults?.string(forKey: latestResultKey) ?? ""

        if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            openHostApp()
            return
        }

        proxy.insertText(text)
    }

    @objc private func openHostApp() {
        guard let url = URL(string: "localflow://quick-dictation") else { return }
        extensionContext?.open(url)
    }
}
