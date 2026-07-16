/**
 * Login — "The Gates" (FableTest port). Two columns: the ceremony panel
 * (crest, title, oath quote, demo accounts) and an ARIA tablist with two
 * panels — Sign in and Create account (username, password with hint, sigil
 * radio picker). Arrow keys move between tabs, as the original did. Errors
 * are plain first with the gate's flavor beneath (.field-error .flavor);
 * success heralds and redirects to the stashed returnTo hash (a gated route
 * the visitor was turned away from) or #/tables, as does an already-signed-in
 * visit. '#/login?tab=oath' opens on the Create account panel — the landing
 * page's 'Create account' CTA points there.
 */
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { herald } from '../Heralds';
import { consumeReturnTo, register, signIn, useUser, type Sigil } from '../state/auth';
import { Edit } from '../state/copy';

interface FieldError {
  plain: string;
  flavor?: string;
}

type GateTab = 'signin' | 'oath';

const SIGILS: Array<{ id: Sigil; label: string }> = [
  { id: 'ember', label: 'Ember' },
  { id: 'raven', label: 'Raven' },
  { id: 'gilt', label: 'Gilt' },
  { id: 'veil', label: 'Veil' },
];

const SIGIL_NAMES: Record<Sigil, string> = {
  ember: 'the Ember', raven: 'the Raven', gilt: 'the Gilt', veil: 'the Veil',
};

/** The router drops hall query params, so read the hash directly:
 * '#/login?tab=oath' lands on the Create account panel. */
function gateTabFromHash(): GateTab {
  const raw = window.location.hash;
  const q = raw.indexOf('?');
  return q >= 0 && new URLSearchParams(raw.slice(q + 1)).get('tab') === 'oath'
    ? 'oath'
    : 'signin';
}

export function Login({ navigate }: { navigate: (hash: string) => void }) {
  const user = useUser();
  const [tab, setTab] = useState<GateTab>(gateTabFromHash);

  const signinTabRef = useRef<HTMLButtonElement>(null);
  const oathTabRef = useRef<HTMLButtonElement>(null);
  const signinNameRef = useRef<HTMLInputElement>(null);
  const signinWordRef = useRef<HTMLInputElement>(null);
  const oathNameRef = useRef<HTMLInputElement>(null);
  const oathWordRef = useRef<HTMLInputElement>(null);

  const [signinNameError, setSigninNameError] = useState<FieldError | null>(null);
  const [signinWordError, setSigninWordError] = useState<FieldError | null>(null);
  const [oathNameError, setOathNameError] = useState<FieldError | null>(null);
  const [oathWordError, setOathWordError] = useState<FieldError | null>(null);

  // The sworn need no gate: straight through — back to wherever a gate
  // turned them away from (returnTo), or the tables. This effect is the ONE
  // navigation point after sign-in/registration; the submit handlers don't
  // navigate, or their consume would race this effect's '#/tables' default.
  // The ref guards StrictMode's double effect (consume is destructive).
  const entered = useRef(false);
  useEffect(() => {
    if (user && !entered.current) {
      entered.current = true;
      navigate(consumeReturnTo() ?? '#/tables');
    }
  }, [user, navigate]);

  const selectTab = (next: GateTab) => {
    setTab(next);
    // the original cleared the errors of the panel being shown
    if (next === 'signin') { setSigninNameError(null); setSigninWordError(null); }
    else { setOathNameError(null); setOathWordError(null); }
  };

  // arrow keys move between tabs and select (original setupGate behavior)
  const onTabsKeyDown = (e: KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const tabs: GateTab[] = ['signin', 'oath'];
    const refs = { signin: signinTabRef, oath: oathTabRef };
    const focused: GateTab = e.target === oathTabRef.current ? 'oath'
      : e.target === signinTabRef.current ? 'signin' : tab;
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = tabs[(tabs.indexOf(focused) + delta + tabs.length) % tabs.length];
    selectTab(next);
    refs[next].current?.focus();
  };

  const onSignIn = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSigninNameError(null);
    setSigninWordError(null);
    const form = e.currentTarget;
    const name = signinNameRef.current?.value ?? '';
    const word = signinWordRef.current?.value ?? '';
    if (!name.trim()) {
      setSigninNameError({ plain: 'Username required.', flavor: 'Speak a name. The gate does not guess.' });
      signinNameRef.current?.focus();
      return;
    }
    if (!word) {
      setSigninWordError({ plain: 'Password required.', flavor: 'No watchword, no welcome.' });
      signinWordRef.current?.focus();
      return;
    }
    const result = signIn(name, word);
    if (!result.ok) {
      if (result.reason === 'unknown-name') {
        setSigninNameError({ plain: 'Unknown username.', flavor: 'The gate does not know this name.' });
        signinNameRef.current?.focus();
      } else {
        setSigninWordError({ plain: 'Incorrect password.', flavor: 'The guards are watching now.' });
        signinWordRef.current?.focus();
      }
      return;
    }
    form.reset();
    herald(`Signed in as ${result.user.name}.`);
    // navigation: the user effect above
  };

  const onRegister = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setOathNameError(null);
    setOathWordError(null);
    const form = e.currentTarget;
    const name = oathNameRef.current?.value ?? '';
    const word = oathWordRef.current?.value ?? '';
    const sigil = ((new FormData(form).get('sigil') as Sigil | null) ?? 'ember');

    const failName = (err: FieldError) => { setOathNameError(err); oathNameRef.current?.focus(); };
    const failWord = (err: FieldError) => { setOathWordError(err); oathWordRef.current?.focus(); };

    const h = name.trim().toLowerCase();
    if (!h) return failName({ plain: 'Username required.', flavor: 'An oath needs a name attached.' });
    if (h.length < 3) return failName({ plain: 'At least 3 characters.', flavor: 'The scribes insist.' });
    if (!/^[a-z0-9_-]+$/.test(h)) {
      return failName({ plain: 'Letters, numbers, dashes, and underscores only.', flavor: 'The humble dash. Nothing more.' });
    }
    const result = register(name, word, sigil);
    if (!result.ok) {
      if (result.reason === 'word-short') {
        return failWord({ plain: 'At least 6 characters.', flavor: 'A short watchword is a dead one.' });
      }
      if (result.reason === 'handle-taken') {
        return failName({ plain: 'Username already taken.', flavor: 'The gate already knows this name. Choose another, or sign in.' });
      }
      // handle-format: pre-checks above mirror the store's rules, but map it anyway
      return failName({ plain: 'Letters, numbers, dashes, and underscores only.', flavor: 'The humble dash. Nothing more.' });
    }
    form.reset();
    herald(`Account created. The oath is sworn under ${SIGIL_NAMES[sigil]}.`);
    // The gate christens quietly ('<Handle> of the Yard') — say so once, and
    // point at the rename before anyone wonders who named them.
    herald(`You are sworn in as ${result.user.name} — rename yourself under Profile & settings.`);
    // navigation: the user effect above
  };

  return (
    <section className="screen" data-screen="login" aria-labelledby="login-title">
      <div className="gate">
        <div className="gate-ceremony">
          <svg className="gate-crest" aria-hidden="true"><use href="#mark-crownfall" /></svg>
          <h1 className="gate-title" id="login-title" tabIndex={-1}>
            <Edit id="gate-title" fallback="The Gates" />
          </h1>
          <p className="gate-oath">
            <Edit id="gate-oath" fallback={'“By ember and oath, I enter the hall.\nWhat I win is mine. What I lose was never.”'} />
          </p>
          <div className="gate-demo">
            <p className="eyebrow">Demo accounts</p>
            <ul className="demo-list">
              <li><code>tobit</code> / <code>crown</code> <span className="demo-who">· Keeper of the Hall</span></li>
              <li><code>wren</code> / <code>valor</code> <span className="demo-who">· Lady Wrenfield</span></li>
              <li><code>hollis</code> / <code>oath</code> <span className="demo-who">· Brother Hollis</span></li>
            </ul>
          </div>
        </div>

        <div className="gate-form">
          <div className="gate-tabs" role="tablist" aria-label="Sign in or create account" onKeyDown={onTabsKeyDown}>
            <button
              ref={signinTabRef}
              className="gate-tab"
              id="tab-signin"
              type="button"
              role="tab"
              aria-selected={tab === 'signin'}
              aria-controls="panel-signin"
              onClick={() => selectTab('signin')}
            >
              Sign in
            </button>
            <button
              ref={oathTabRef}
              className="gate-tab"
              id="tab-oath"
              type="button"
              role="tab"
              aria-selected={tab === 'oath'}
              aria-controls="panel-oath"
              onClick={() => selectTab('oath')}
            >
              Create account
            </button>
          </div>

          <form
            className="gate-panel"
            id="panel-signin"
            role="tabpanel"
            aria-labelledby="tab-signin"
            hidden={tab !== 'signin'}
            noValidate
            onSubmit={onSignIn}
          >
            <div className="field">
              <label htmlFor="signin-name">Username</label>
              <input
                ref={signinNameRef}
                id="signin-name"
                name="name"
                type="text"
                autoComplete="username"
                aria-invalid={signinNameError ? true : undefined}
                aria-describedby={signinNameError ? 'signin-name-error' : undefined}
                required
              />
              {signinNameError && (
                <p className="field-error" id="signin-name-error">
                  {signinNameError.plain}
                  {signinNameError.flavor && <span className="flavor">{signinNameError.flavor}</span>}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="signin-word">Password</label>
              <input
                ref={signinWordRef}
                id="signin-word"
                name="word"
                type="password"
                autoComplete="current-password"
                aria-invalid={signinWordError ? true : undefined}
                aria-describedby={signinWordError ? 'signin-word-error' : undefined}
                required
              />
              {signinWordError && (
                <p className="field-error" id="signin-word-error">
                  {signinWordError.plain}
                  {signinWordError.flavor && <span className="flavor">{signinWordError.flavor}</span>}
                </p>
              )}
            </div>
            <button className="btn btn-primary btn-block" type="submit">Sign in</button>
          </form>

          <form
            className="gate-panel"
            id="panel-oath"
            role="tabpanel"
            aria-labelledby="tab-oath"
            hidden={tab !== 'oath'}
            noValidate
            onSubmit={onRegister}
          >
            <div className="field">
              <label htmlFor="oath-name">Username</label>
              <input
                ref={oathNameRef}
                id="oath-name"
                name="name"
                type="text"
                autoComplete="username"
                aria-invalid={oathNameError ? true : undefined}
                aria-describedby={oathNameError ? 'oath-name-error' : undefined}
                required
              />
              {oathNameError && (
                <p className="field-error" id="oath-name-error">
                  {oathNameError.plain}
                  {oathNameError.flavor && <span className="flavor">{oathNameError.flavor}</span>}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="oath-word">Password</label>
              <input
                ref={oathWordRef}
                id="oath-word"
                name="word"
                type="password"
                autoComplete="new-password"
                aria-invalid={oathWordError ? true : undefined}
                aria-describedby={oathWordError ? 'oath-word-hint oath-word-error' : 'oath-word-hint'}
                required
              />
              <p className="field-hint" id="oath-word-hint">Six characters or more. The gate forgets nothing.</p>
              {oathWordError && (
                <p className="field-error" id="oath-word-error">
                  {oathWordError.plain}
                  {oathWordError.flavor && <span className="flavor">{oathWordError.flavor}</span>}
                </p>
              )}
            </div>
            <fieldset className="field sigil-pick">
              <legend>Choose your sigil</legend>
              <div className="sigil-options">
                {SIGILS.map((s) => (
                  <label key={s.id} className="sigil-option">
                    <input type="radio" name="sigil" value={s.id} defaultChecked={s.id === 'ember'} />
                    <svg aria-hidden="true"><use href={`#crest-${s.id}`} /></svg>
                    <span>{s.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button className="btn btn-primary btn-block" type="submit">Create account</button>
          </form>
        </div>
      </div>
    </section>
  );
}
