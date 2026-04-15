import { Link } from "wouter";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'General Sans', 'Inter', sans-serif" }}>
      <header className="sticky top-0 z-50 border-b border-border/60 bg-white/80 backdrop-blur-md">
        <div className="max-w-screen-xl mx-auto px-4 h-14 flex items-center">
          <Link href="/">
            <span className="text-sm font-semibold text-foreground hover:opacity-80 transition-opacity cursor-pointer">
              &larr; Back to The Visual Sitemapper
            </span>
          </Link>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Last updated: April 14, 2026</p>

        <div className="prose prose-sm prose-gray max-w-none space-y-6 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">1. Introduction</h2>
            <p>
              The Visual Sitemapper ("we", "our", or "us") operates the website at{" "}
              <strong>app.thevisualsitemap.com</strong>. This Privacy Policy explains how we collect,
              use, and protect your information when you use our service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">2. Information We Collect</h2>
            <p><strong>Account information:</strong> When you create an account, we collect your name, email address, and a securely hashed password. We never store your password in plain text.</p>
            <p><strong>Usage data:</strong> We collect information about the websites you crawl (URLs, page counts, crawl timestamps) to provide the service and display your sitemap history.</p>
            <p><strong>Screenshots:</strong> Our service captures screenshots of publicly accessible web pages you choose to crawl. These screenshots are stored temporarily to render your visual sitemaps.</p>
            <p><strong>Payment information:</strong> If you subscribe to our Pro plan, payment is processed through Stripe. We do not store your credit card details — Stripe handles all payment data securely.</p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>To provide, maintain, and improve the service</li>
              <li>To authenticate your account and manage your subscription</li>
              <li>To send transactional emails (account verification, password resets)</li>
              <li>To enforce usage limits associated with your plan tier</li>
              <li>To respond to support requests</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">4. Data Storage &amp; Security</h2>
            <p>
              Your data is stored on secure servers. Passwords are hashed using bcrypt. Authentication
              tokens are signed with JWT and expire after 7 days. We use HTTPS for all data transmission.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">5. Data Sharing</h2>
            <p>
              We do not sell, rent, or share your personal information with third parties, except:
            </p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li><strong>Stripe:</strong> For payment processing (Pro subscribers only)</li>
              <li><strong>Email delivery:</strong> We use SMTP to send verification and transactional emails</li>
              <li><strong>Legal requirements:</strong> If required by law or to protect our rights</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">6. Cookies &amp; Local Storage</h2>
            <p>
              We use an authentication token stored in your browser's memory (not cookies or local storage)
              to keep you signed in during your session. We do not use tracking cookies or third-party analytics.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Access the personal data we hold about you</li>
              <li>Request deletion of your account and associated data</li>
              <li>Cancel your Pro subscription at any time</li>
            </ul>
            <p>
              To exercise any of these rights, contact us at{" "}
              <a href="mailto:support@thevisualsitemap.com" className="text-blue-600 hover:underline">
                support@thevisualsitemap.com
              </a>.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">8. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted on this page
              with an updated revision date. Continued use of the service constitutes acceptance of the
              revised policy.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-2">9. Contact</h2>
            <p>
              If you have questions about this Privacy Policy, please email us at{" "}
              <a href="mailto:support@thevisualsitemap.com" className="text-blue-600 hover:underline">
                support@thevisualsitemap.com
              </a>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
