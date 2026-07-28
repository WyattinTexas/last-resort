import UIKit

// SURVIVAL QUEST iOS shell — a fullscreen WKWebView over the live Pages build.
// The game itself ships from the web (one codebase); this wrapper gives it a
// home screen icon, landscape lock, persistent storage and TestFlight.
//
// ⚠ SCENE-BASED lifecycle, deliberately (the FAVOR shell's Ipad_Wonky lesson):
// a legacy AppDelegate window takes UIScreen.main.bounds at launch and never
// tracks the scene, and iPadOS 18 — which ignores UIRequiresFullScreen under
// Stage Manager — leaves the canvas letterboxed at its launch size, black bars
// both sides. The window must come from the scene and resize with it. Do not
// "simplify" this back to a launch-time UIWindow(frame:).
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // the tide does not pause for a sleepy screen
        application.isIdleTimerDisabled = true
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default", sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }
        let w = UIWindow(windowScene: windowScene)
        w.backgroundColor = UIColor(red: 0x06 / 255.0, green: 0x2A / 255.0, blue: 0x38 / 255.0, alpha: 1)
        w.rootViewController = GameViewController()
        w.makeKeyAndVisible()
        window = w
    }
}
