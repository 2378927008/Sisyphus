import UIKit

final class KeyboardViewController: UIInputViewController {
    private let appGroupIdentifier = "group.com.localflow.dictation"
    private let latestResultKey = "latestResultText"
    private let statusLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        configureStatusLabel()

        let insertButton = makeButton(title: "Insert Latest", action: #selector(insertLatestResult))
        let dictateButton = makeButton(title: "Dictate", action: #selector(openHostApp))

        let buttonRow = UIStackView(arrangedSubviews: [insertButton, dictateButton])
        buttonRow.axis = .horizontal
        buttonRow.spacing = 8
        buttonRow.distribution = .fillEqually

        let stack = UIStackView(arrangedSubviews: [statusLabel, buttonRow])
        stack.axis = .vertical
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8)
        ])
    }

    private func configureStatusLabel() {
        statusLabel.text = "Ready"
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 1
        statusLabel.font = .preferredFont(forTextStyle: .caption1)
        statusLabel.textColor = .secondaryLabel
    }

    private func setStatus(_ text: String) {
        statusLabel.text = text
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
            openHostApp(status: "No saved result yet. Opening Local Flow.")
            return
        }

        proxy.insertText(text)
        setStatus("Inserted latest result.")
    }

    @objc private func openHostApp() {
        openHostApp(status: "Opening Local Flow.")
    }

    private func openHostApp(status: String) {
        setStatus(status)
        guard let url = URL(string: "localflow://quick-dictation") else { return }
        extensionContext?.open(url)
    }
}
