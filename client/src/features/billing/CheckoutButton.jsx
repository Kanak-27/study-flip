import { useState } from 'react';
import { api, ApiError } from '../../api/client.js';
import { openSubscriptionCheckout } from './cashfree.js';

// Starts a Cashfree subscription checkout. Cashfree mandates need a mobile
// number, so the first attempt asks for one when the account has none.
export default function CheckoutButton({
  label = 'Upgrade to Premium',
  buttonClassName = '',
  inputClassName = '',
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [needsPhone, setNeedsPhone] = useState(false);
  const [phone, setPhone] = useState('');

  async function begin(value) {
    setBusy(true);
    setError(null);
    try {
      const { subsSessionId, mode } = await api('/api/billing/checkout', {
        method: 'POST',
        body: value ? { phone: value } : {},
      });
      setNeedsPhone(false);
      await openSubscriptionCheckout({ subsSessionId, mode });
      setBusy(false);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'phone_required') {
        setNeedsPhone(true);
      } else {
        setError(err?.message ?? 'Could not start checkout. Try again later.');
      }
      setBusy(false);
    }
  }

  if (needsPhone) {
    return (
      <form
        className="mt-3 space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          begin(phone);
        }}
      >
        <label className="block text-xs font-medium text-slate-600" htmlFor="checkout-phone">
          Mobile number for the recurring payment mandate
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="checkout-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="10-digit mobile number"
            className={`min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-forest-700 focus:outline-none ${inputClassName}`}
          />
          <button type="submit" disabled={busy} className={buttonClassName || 'btn-primary'}>
            {busy ? 'Opening…' : 'Continue to payment'}
          </button>
        </div>
        <p className="text-[11px] text-slate-400">
          Cashfree uses this to authorise the auto-debit mandate. We never show it to other users.
        </p>
        {error && <ErrorNote message={error} />}
      </form>
    );
  }

  return (
    <>
      <button type="button" onClick={() => begin()} disabled={busy} className={buttonClassName}>
        {busy ? 'Opening payment…' : label}
      </button>
      {error && <ErrorNote message={error} />}
    </>
  );
}

function ErrorNote({ message }) {
  return (
    <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
      {message}
    </p>
  );
}
