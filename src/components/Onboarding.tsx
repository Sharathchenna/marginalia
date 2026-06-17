import type { Store } from "../store";
import { BookLogoIcon } from "../icons";

export function Onboarding({ store: s }: { store: Store }) {
  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-logo">
          <BookLogoIcon size={32} />
        </div>
        <h1>Welcome to Marginalia</h1>
        <p>
          Your local-first home for reading, annotating, and citing research.
          Choose a folder — every PDF and your library will be stored there.
        </p>
        <div className="onboarding-actions">
          <button className="ob-primary" onClick={s.chooseLibrary}>
            Choose library folder…
          </button>
          <button className="ob-secondary" onClick={s.chooseLibrary}>
            Use an existing folder
          </button>
          <button className="ob-skip" onClick={s.finishOnboarding}>
            Skip — use a demo library
          </button>
        </div>
      </div>
    </div>
  );
}
