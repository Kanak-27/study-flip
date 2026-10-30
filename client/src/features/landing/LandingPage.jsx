import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';

// Public landing page. One accent color, one job per section: state the
// promise, show how it works, name the price, send the visitor to register.
export default function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-canvas text-slate-900">
      {/* Top bar: wordmark, in-page nav, auth actions — mirrors the app
          header so the transition after sign-up feels continuous. */}
      <header className="sticky top-0 z-50 border-b border-slate-200/70 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 sm:py-4">
          <Link to="/" className="text-xl font-black tracking-tight">
            studyflip<span className="text-forest-800">.</span>
          </Link>
          <nav className="hidden gap-6 text-sm font-medium text-slate-600 sm:flex lg:gap-8">
            <a href="#how" className="border-b-2 border-transparent pb-0.5 hover:border-forest-800 hover:text-forest-800">
              How it works
            </a>
            <a href="#features" className="border-b-2 border-transparent pb-0.5 hover:border-forest-800 hover:text-forest-800">
              Features
            </a>
            <a href="#pricing" className="border-b-2 border-transparent pb-0.5 hover:border-forest-800 hover:text-forest-800">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-3">
            {user ? (
              <Link to="/" className="btn-primary !px-5 !py-2">
                Open dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="text-sm font-medium text-slate-600 hover:text-forest-800">
                  Sign in
                </Link>
                <Link to="/register" className="btn-primary !px-5 !py-2">
                  Get started
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero: oversized headline left, floating flashcard stack right */}
      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:grid-cols-2 lg:pt-24">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-forest-600">
            Spaced repetition, simplified
          </p>
          <h1 className="text-5xl font-black leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">
            STUDY
            <br />
            SMARTER<span className="text-forest-800">.</span>
          </h1>
          <p className="mt-6 max-w-md text-base leading-relaxed text-slate-600">
            Turn any PDF into flashcards in minutes. StudyFlip schedules every review at the
            moment you're about to forget — so less time rereading, more time remembering.
          </p>
          <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:gap-4">
            <Link to="/register" className="btn-primary justify-center">
              Start learning
              <span aria-hidden>→</span>
            </Link>
            <a href="#how" className="btn-secondary justify-center">
              See how it works
            </a>
          </div>
          <p className="mt-4 text-xs text-slate-500">Free forever for manual decks · No card required</p>
        </div>

        {/* Decorative stack: two back cards + one front Q/A card, pure CSS */}
        <div className="relative mx-auto hidden h-80 w-full max-w-md lg:block" aria-hidden>
          <div className="absolute left-6 top-8 h-64 w-full rotate-[-6deg] rounded-2xl border border-forest-200 bg-forest-100" />
          <div className="absolute left-3 top-4 h-64 w-full rotate-[-3deg] rounded-2xl border border-forest-200 bg-forest-50" />
          <div className="absolute inset-x-8 top-0 h-64 rounded-2xl border border-slate-200 bg-white p-8 shadow-lg">
            <span className="text-xs font-semibold uppercase tracking-widest text-forest-600">Question</span>
            <p className="mt-4 text-lg font-semibold leading-snug">
              When should you review a card to remember it longest?
            </p>
            <div className="absolute inset-x-8 bottom-6 px-8">
              <span className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                Tap to reveal
              </span>
            </div>
          </div>
          <div className="absolute bottom-0 right-2 rounded-xl border border-forest-200 bg-forest-800 px-4 py-2 text-sm font-medium text-white shadow-md">
            Easy · +21 days
          </div>
          <div className="absolute bottom-14 left-0 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
            Day streak: 12 🔥
          </div>
        </div>
      </section>

      {/* Feature row: three columns, icon + title + line — the image's
          Feeding/Light/Care strip, in our vocabulary */}
      <section id="how" className="border-y border-slate-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:grid-cols-3 sm:px-6 sm:py-16">
          <Feature
            icon="📄"
            title="Upload"
            text="Drop in a PDF of your notes or a textbook chapter. We extract the text in seconds."
          />
          <Feature
            icon="⚡"
            title="Generate"
            text="AI turns the material into question-and-answer flashcards. Edit or add your own anytime."
          />
          <Feature
            icon="🧠"
            title="Review"
            text="The SM-2 scheduler brings each card back right before you'd forget it. Three buttons, done."
          />
        </div>
      </section>

      {/* Features list */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <h2 className="text-2xl font-black tracking-tight sm:text-3xl">
          Everything you need to actually stick<span className="text-forest-800">.</span>
        </h2>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard title="Spaced repetition" text="SM-2 scheduling with Again / Hard / Easy. Failed cards come back moments later, not tomorrow." />
          <FeatureCard title="Study sessions" text="Flip cards in a focused session view — keyboard shortcuts, progress bar, zero clutter." />
          <FeatureCard title="Real analytics" text="Recall accuracy, daily activity, and a day streak that keeps you honest." />
          <FeatureCard title="Deck management" text="Create, edit, and organize decks by hand — no PDF required, ever." />
          <FeatureCard title="Honest quotas" text="Five AI generations a month on the free plan. Upgrade only when you outgrow it." />
          <FeatureCard title="Private by default" text="Your decks belong to you. Every query is scoped to your account." />
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 className="text-2xl font-black tracking-tight sm:text-3xl">Simple pricing</h2>
          <p className="mt-2 text-slate-600">The learning loop is free forever. Pay only for AI volume.</p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:max-w-3xl">
            <div className="card p-6 sm:p-8">
              <h3 className="text-lg font-semibold">Free</h3>
              <p className="mt-2 text-3xl font-black">
                $0<span className="text-sm font-medium text-slate-500">/month</span>
              </p>
              <ul className="mt-6 space-y-2 text-sm text-slate-600">
                <li>✓ Manual decks & unlimited cards</li>
                <li>✓ Study sessions & SM-2 scheduling</li>
                <li>✓ Dashboard & analytics</li>
                <li>✓ 5 AI generations / month</li>
              </ul>
              <Link to="/register" className="btn-secondary mt-8 w-full justify-center">
                Start free
              </Link>
            </div>
            <div className="card border-forest-800 p-6 ring-1 ring-forest-800 sm:p-8">
              <h3 className="text-lg font-semibold">
                Premium
                <span className="ml-2 inline-block rounded-full bg-forest-800 px-2 py-0.5 text-xs font-medium text-white">
                  Most popular
                </span>
              </h3>
              <p className="mt-2 text-3xl font-black">
                $8<span className="text-sm font-medium text-slate-500">/month</span>
              </p>
              <ul className="mt-6 space-y-2 text-sm text-slate-600">
                <li>✓ Everything in Free</li>
                <li>✓ 200 AI generations / month</li>
                <li>✓ Larger uploads (25 MB)</li>
                <li>✓ Priority processing</li>
              </ul>
              <Link to="/register" className="btn-primary mt-8 w-full justify-center">
                Upgrade at signup
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
          <span className="font-black tracking-tight text-slate-900">
            studyflip<span className="text-forest-800">.</span>
          </span>
          <p>Remember more, in less time.</p>
        </div>
      </footer>
    </div>
  );
}

function Feature({ icon, title, text }) {
  return (
    <div className="flex gap-4">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-forest-50 text-2xl">
        {icon}
      </div>
      <div>
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
      </div>
    </div>
  );
}

function FeatureCard({ title, text }) {
  return (
    <div className="card p-6 transition-shadow hover:shadow-sm">
      <div className="h-1.5 w-10 rounded-full bg-forest-800" />
      <h3 className="mt-4 font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">{text}</p>
    </div>
  );
}
